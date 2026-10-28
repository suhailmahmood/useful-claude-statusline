#!/usr/bin/env node
// Claude Code status line. Reads session JSON on stdin, prints 2 lines.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// C.d = default foreground, not faint (SGR 2): faint is unreadable on transparent/light terminals
const C = { r: '\x1b[0m', d: '\x1b[39m', g: '\x1b[32m', y: '\x1b[33m', R: '\x1b[31m', c: '\x1b[36m', m: '\x1b[35m', b: '\x1b[34m', B: '\x1b[1m' };
const SEP = ` ${C.d}│${C.r} `;

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const color = (pct, warn = 60, crit = 85) => (pct >= crit ? C.R : pct >= warn ? C.y : C.g);
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
const fmtDur = (s) => {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d${String(h).padStart(2, '0')}h` : h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
};
const bar = (pct, w = 10) => {
  const f = Math.min(w, Math.max(0, Math.round((pct / 100) * w)));
  return '█'.repeat(f) + C.d + '░'.repeat(w - f) + C.r;
};

// Parse "200000", "500k", "1M", "200" (thousands)
function parseWindow(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1000 ? v * 1000 : v;
  const m = String(v).trim().toLowerCase().match(/^([\d.]+)\s*([km]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === 'm') return n * 1e6;
  if (m[2] === 'k') return n * 1e3;
  return n < 1000 ? n * 1000 : n;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(raw); } catch {}
  try { console.log(render(j)); } catch (e) { console.log('statusline error: ' + e.message); }
});

function render(j) {
  const home = os.homedir();
  const settings = readJson(path.join(home, '.claude', 'settings.json')) || {};
  const claudeJson = readJson(path.join(home, '.claude.json')) || {};
  const cwd = j.workspace?.current_dir || j.cwd || process.cwd();
  const projDir = j.workspace?.project_dir || cwd;

  // ---- cells (grid: 2 rows x 6 cols)
  const model = j.model?.display_name || j.model?.id || '?';
  let mdl = `${C.B}${C.c}${model}${C.r}`;
  const eff = j.effort?.level;
  if (eff) mdl += ` ${C.m}${eff}${C.r}`;
  if (j.thinking?.enabled) mdl += `${C.d}+think${C.r}`;
  if (j.fast_mode) mdl += ` ${C.y}⚡fast${C.r}`;

  const rl = j.rate_limits || {};
  const lim = (label, w) => {
    if (!w || w.used_percentage == null) return `${C.d}${label} –${C.r}`;
    const p = w.used_percentage;
    let s = `${C.d}${label}${C.r} ${color(p, 60, 85)}${(p.toFixed(0) + '%').padStart(4)}${C.r}`;
    if (w.resets_at) s += ` ${C.d}⟳ ${fmtDur(w.resets_at - Date.now() / 1000).padStart(6)}${C.r}`;
    return s;
  };
  const h5 = lim('5h', rl.five_hour);
  const d7 = lim('7d', rl.seven_day);

  const cost = j.cost;
  let costCell = '';
  if (cost) {
    costCell = `${C.y}$${(cost.total_cost_usd || 0).toFixed(2)}${C.r} ${C.d}·${C.r} ${fmtDur((cost.total_duration_ms || 0) / 1000)}`;
    if (cost.total_lines_added || cost.total_lines_removed)
      costCell += ` ${C.g}+${cost.total_lines_added || 0}${C.r}/${C.R}-${cost.total_lines_removed || 0}${C.r}`;
  }

  const cw = j.context_window || {};
  const modelId = j.model?.id;
  const win =
    parseWindow(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) ||
    parseWindow(settings.modelSettings?.[modelId]?.autoCompactWindow) ||
    parseWindow(settings.modelSettings?.[model]?.autoCompactWindow) ||
    parseWindow(settings.autoCompactWindow) ||
    cw.context_window_size ||
    null;
  const u = cw.current_usage;
  const used = u ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) : 0;
  const pct = win ? (used / win) * 100 : 0;
  const cc = color(pct, 60, 85);
  const ctx = !win ? `${C.d}ctx –${C.r}` : `${cc}${bar(pct)}${C.r} ${cc}${pct.toFixed(0)}%${C.r} ${C.d}${fmtTok(used)}/${fmtTok(win)}${C.r}${pct >= 100 ? ` ${C.R}COMPACT${C.r}` : ''}`;

  let cache = `${C.d}cache –${C.r}`; // no data until the first request of a launched session
  if (j.prompt_cache?.caching_observed) {
    const pc = j.prompt_cache;
    const left = pc.expires_at ? pc.expires_at - Date.now() / 1000 : null;
    cache = `${C.d}cache${C.r} ` + (pc.warm
      ? `${C.g}warm${C.r}${left != null ? ` ${C.d}${fmtDur(left)}${C.r}` : ''}`
      : `${C.y}cold${C.r}`);
    if (typeof pc.hit_ratio === 'number') {
      const hr = pc.hit_ratio <= 1 ? pc.hit_ratio * 100 : pc.hit_ratio; // accept 0-1 or 0-100
      cache += ` ${color(100 - hr, 20, 50)}${hr.toFixed(0)}%${C.r}`;
    }
  }

  const mcp = mcpServers(settings, claudeJson, projDir);
  const MCP_MIN = 16; // reserve space so the mcp column doesn't jump around
  const mcpRow = (tag, names, col) => {
    const s = `${C.d}mcp${C.r} ${col}${tag}${C.r}: ${names.join(',')}`.trimEnd();
    return s + ' '.repeat(Math.max(0, MCP_MIN - vis(s)));
  };
  const mcpG = mcpRow('G', mcp.global, C.g);
  const mcpL = mcpRow('L', mcp.local, C.y);

  const sl = rl.spend_limit;
  const spend = sl && sl.used_percentage != null
    ? `${C.d}spend:${C.r} ${color(sl.used_percentage)}${sl.used_percentage.toFixed(0)}%${C.r}${sl.used_usd != null ? ` ${C.d}$${sl.used_usd}/${sl.limit_usd}${C.r}` : ''}`
    : ''; // empty unless Claude sends rate_limits.spend_limit
  const agentCell = j.agent?.name ? `${C.d}agent:${C.r} ${C.m}${j.agent.name}${C.r}` : ''; // empty unless --agent / agent settings

  // ---- col 1 (project / git) shrinks to fit terminal width
  const git = gitInfo(cwd);
  let tail = '';
  if (git) {
    if (git.staged) tail += ` ${C.g}+${git.staged}${C.r}`;
    if (git.mod) tail += ` ${C.y}~${git.mod}${C.r}`;
    if (git.untracked) tail += ` ${C.d}?${git.untracked}${C.r}`;
    if (git.ahead) tail += ` ${C.g}↑${git.ahead}${C.r}`;
    if (git.behind) tail += ` ${C.R}↓${git.behind}${C.r}`;
  }
  if (j.pr?.number) tail += ` ${C.c}PR#${j.pr.number}${C.r}`;

  const rest = [[mdl, ctx], [h5, d7], [costCell, cache], [mcpG, mcpL], [agentCell, spend]];
  const restW = rest.reduce((s, [a, b]) => s + Math.max(vis(a), vis(b)), 0);
  const cols = parseInt(process.env.COLUMNS, 10) || 120;
  const cap = Math.max(10, Math.min(30, cols - restW - rest.length * 3 - 2));

  const proj = path.basename(cwd) || cwd;
  const r1c1 = `${C.b}${trunc(proj, cap)}${C.r}`;
  let r2c1 = '';
  if (git) {
    const room = Math.max(4, cap - 2 - vis(tail));
    r2c1 = `${C.m}⎇ ${trunc(git.branch, room)}${C.r}${tail}`;
  } else {
    r2c1 = `${C.d}(no git)${C.r}${tail}`; // not a repo
  }

  return align([[mdl, r1c1, h5, costCell, mcpG, agentCell], [ctx, r2c1, d7, cache, mcpL, spend]]);
}

const vis = (t) => t.replace(/\x1b\[[0-9;]*m/g, '').length;
const trunc = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
// Pad every column to equal width across all rows so separators line up.
function align(rows) {
  // drop trailing columns that are empty in every row (no dangling separator)
  let n = Math.max(...rows.map((r) => r.length));
  while (n > 1 && rows.every((r) => !vis(r[n - 1] || ''))) n--;
  const w = Array.from({ length: n }, (_, i) => Math.max(...rows.map((r) => vis(r[i] || ''))));
  const fmt = (L) => {
    // keep empty cells so every separator is drawn
    const cells = Array.from({ length: n }, (_, i) => L[i] || '');
    return cells.map((t, i) => (i < n - 1 ? t + ' '.repeat(w[i] - vis(t)) : t)).join(SEP).trimEnd();
  };
  return rows.map(fmt).join('\n');
}

function gitInfo(cwd) {
  try {
    const out = execFileSync('git', ['status', '--porcelain=v2', '--branch'], { cwd, encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
    const r = { branch: '', staged: 0, mod: 0, untracked: 0, ahead: 0, behind: 0 };
    for (const line of out.split('\n')) {
      if (line.startsWith('# branch.head ')) r.branch = line.slice(14);
      else if (line.startsWith('# branch.oid ') && !r.branch) r.branch = line.slice(13, 20);
      else if (line.startsWith('# branch.ab ')) {
        const m = line.match(/\+(\d+) -(\d+)/);
        if (m) { r.ahead = +m[1]; r.behind = +m[2]; }
      } else if (line[0] === '1' || line[0] === '2') {
        const x = line[2], y = line[3];
        if (x !== '.') r.staged++;
        if (y !== '.') r.mod++;
      } else if (line[0] === 'u') r.mod++;
      else if (line[0] === '?') r.untracked++;
    }
    if (r.branch === '(detached)') r.branch = 'detached';
    return r;
  } catch { return null; }
}

// Global = user scope (~/.claude.json mcpServers).
// Local  = project .mcp.json + per-project local scope in ~/.claude.json.
function mcpServers(settings, claudeJson, projDir) {
  const denied = new Set((settings.deniedMcpServers || []).map((d) => d.serverName));
  const key = norm(projDir);
  const projEntry = Object.entries(claudeJson.projects || {}).find(([k]) => norm(k) === key)?.[1] || {};
  const disabledJson = new Set(projEntry.disabledMcpjsonServers || []);
  const global = Object.keys(claudeJson.mcpServers || {}).filter((n) => !denied.has(n));
  const local = new Set(Object.keys(projEntry.mcpServers || {}));
  const mj = readJson(path.join(projDir, '.mcp.json'));
  for (const n of Object.keys(mj?.mcpServers || {})) if (!disabledJson.has(n)) local.add(n);
  return { global, local: [...local].filter((n) => !denied.has(n) && !global.includes(n)) };
}
