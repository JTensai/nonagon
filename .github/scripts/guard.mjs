// Safety check for bot-built pull requests. The auto-merge workflow runs this
// from main (never from the PR), and the daily bot runs it before pushing.
//   node .github/scripts/guard.mjs <base> <head>
// Exits 1 and lists the problems if the change goes outside what the bot may touch.
import { execFileSync } from 'node:child_process';

const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });

const MAX_FILES = 20;
const MAX_LINES = 800;
// The bot may only change the app itself...
const ALLOWED = [/^public\/.+\.(html|css|js|svg)$/];
// ...and never sign-in, Firebase wiring, the request form or the privacy policy.
const BLOCKED = [
  /^public\/js\/config\.js$/, /^public\/js\/firebase\.js$/, /^public\/js\/auth\.js$/,
  /^public\/js\/feedback\.js$/, /^public\/privacy\.html$/,
];
// New code may only reach these hosts.
const HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.w3.org', 'jtensai.github.io', 'github.com'];
const BANNED = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/document\.cookie/, 'document.cookie'],
  [/\b(navigator\.sendBeacon|WebSocket|EventSource)\b/, 'a network channel'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bfetch\s*\(|XMLHttpRequest/, 'a network request'],
  [/\bimport\s*\(/, 'a dynamic import'],
  [/\b(atob|fromCharCode)\s*\(/, 'encoded strings'],
];

const problems = [];
const range = `${base}...${head}`;

const status = git('diff', '--name-status', '--no-renames', range).trim().split('\n').filter(Boolean);
for (const line of status) {
  const [st, file] = line.split('\t');
  if (st === 'D') problems.push(`deletes ${file}`);
  if (BLOCKED.some((r) => r.test(file))) problems.push(`changes a protected file: ${file}`);
  else if (!ALLOWED.some((r) => r.test(file))) problems.push(`changes a file outside the app: ${file}`);
}
if (status.length > MAX_FILES) problems.push(`changes ${status.length} files (limit ${MAX_FILES})`);

let lines = 0;
for (const row of git('diff', '--numstat', '--no-renames', range).trim().split('\n').filter(Boolean)) {
  const [a, d, file] = row.split('\t');
  if (a === '-') { problems.push(`adds a binary file: ${file}`); continue; }
  lines += Number(a) + Number(d);
}
if (lines > MAX_LINES) problems.push(`changes ${lines} lines (limit ${MAX_LINES})`);

const patch = git('diff', '-U0', '--no-renames', range);
let file = '';
for (const l of patch.split('\n')) {
  if (l.startsWith('+++ ')) { file = l.replace(/^\+\+\+ (b\/)?/, ''); continue; }
  if (!l.startsWith('+')) continue;
  for (const m of l.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase();
    if (!HOSTS.includes(host)) problems.push(`${file}: links to ${host}`);
  }
  for (const [re, what] of BANNED) if (re.test(l)) problems.push(`${file}: uses ${what}`);
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.log('Guard failed:\n' + unique.map((p) => '- ' + p).join('\n'));
  process.exit(1);
}
console.log(`Guard passed: ${status.length} files, ${lines} lines.`);
