#!/usr/bin/env node
// Installs statusline.js into ~/.claude and points settings.json at it.
// Usage: node install.js [--yes]   (--yes: overwrite an existing statusLine without asking)
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const yes = process.argv.includes('--yes') || process.argv.includes('-y');
const claudeDir = path.join(os.homedir(), '.claude');
const target = path.join(claudeDir, 'statusline.js');
const settingsPath = path.join(claudeDir, 'settings.json');
const fwd = (p) => p.replace(/\\/g, '/'); // forward slashes work on every OS
const command = `node ${/\s/.test(target) ? `"${fwd(target)}"` : fwd(target)}`;
const statusLine = { type: 'command', command, refreshInterval: 30 };

const ask = (q) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
});
const fail = (msg) => { console.error(msg); process.exit(1); };

(async () => {
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
    catch (e) { fail(`Cannot parse ${settingsPath} (${e.message}). Fix it or remove it, then re-run. Nothing was changed.`); }
  }

  const cur = settings.statusLine;
  if (cur && JSON.stringify(cur) !== JSON.stringify(statusLine) && !yes) {
    console.log(`An existing statusLine is configured:\n  ${JSON.stringify(cur)}`);
    if (!process.stdin.isTTY) fail('Re-run with --yes to replace it. Nothing was changed.');
    if (!(await ask('Replace it? [y/N] '))) fail('Aborted. Nothing was changed.');
  }

  fs.mkdirSync(claudeDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'statusline.js'), target);

  if (fs.existsSync(settingsPath)) {
    const backup = `${settingsPath}.bak-before-statusline-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(settingsPath, backup);
    console.log(`Backed up settings to ${backup}`);
  }
  settings.statusLine = statusLine;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  console.log(`Installed ${target}\nUpdated ${settingsPath}\nStart a new Claude Code session to see it.`);
})();
