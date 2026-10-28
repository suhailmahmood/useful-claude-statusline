#!/usr/bin/env node
// Renders statusline.js with sample data (fake home/config) to docs/screenshot.svg.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
const proj = path.join(tmp, 'work', 'my-project');
fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
fs.mkdirSync(proj, { recursive: true });
fs.writeFileSync(path.join(tmp, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 200000 }));
fs.writeFileSync(path.join(tmp, '.claude.json'), JSON.stringify({ mcpServers: { github: {}, context7: {} } }));
fs.writeFileSync(path.join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { postgres: {} } }));

const now = Date.now() / 1000;
const input = {
  model: { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' },
  effort: { level: 'medium' },
  thinking: { enabled: true },
  cwd: proj,
  context_window: { context_window_size: 1000000, current_usage: { input_tokens: 3000, cache_creation_input_tokens: 9000, cache_read_input_tokens: 95000 } },
  prompt_cache: { caching_observed: true, warm: true, expires_at: now + 240, hit_ratio: 0.92 },
  cost: { total_cost_usd: 1.23, total_duration_ms: 2520000, total_lines_added: 194, total_lines_removed: 7 },
  rate_limits: { five_hour: { used_percentage: 37, resets_at: now + 13740 }, seven_day: { used_percentage: 71, resets_at: now + 46740 }, spend_limit: { used_percentage: 42, used_usd: 21, limit_usd: 50 } },
  agent: { name: 'reviewer' },
};
const out = execFileSync('node', [path.join(__dirname, 'statusline.js')], {
  input: JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, HOME: tmp, USERPROFILE: tmp, COLUMNS: '110' },
});

// ANSI -> SVG
const PAL = { 30: '#6e7681', 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341', 34: '#79c0ff', 35: '#d2a8ff', 36: '#56d4dd' };
const FG = '#e6edf3';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rows = out.replace(/\n$/, '').split('\n').map((line) => {
  let st = { c: FG, b: false, d: false }, spans = [];
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (m) {
      for (const n of (m[1] || '0').split(';').map(Number)) {
        if (n === 0) st = { c: FG, b: false, d: false };
        else if (n === 1) st.b = true;
        else if (n === 39) st.c = FG;
        else if (PAL[n]) st.c = PAL[n];
      }
    } else if (part) spans.push({ t: part, ...st });
  }
  return spans;
});
const cw = 8.4, lh = 22, pad = 18;
const width = Math.ceil(Math.max(...rows.map((r) => [...r.map((s) => s.t).join('')].length)) * cw + pad * 2);
const height = rows.length * lh + pad * 2 - 4;
const body = rows
  .map((spans, i) => {
    const t = spans
      .map((s) => `<tspan fill="${s.c}"${s.b ? ' font-weight="bold"' : ''}${s.d ? ' opacity="0.6"' : ''}>${esc(s.t)}</tspan>`)
      .join('');
    return `<text x="${pad}" y="${pad + 14 + i * lh}" xml:space="preserve">${t}</text>`;
  })
  .join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Cascadia Mono, Consolas, Menlo, monospace" font-size="14">
<rect width="100%" height="100%" rx="8" fill="#0d1117"/>
${body}
</svg>
`;
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'docs', 'screenshot.svg'), svg);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(out.replace(/\x1b\[[0-9;]*m/g, ''));
