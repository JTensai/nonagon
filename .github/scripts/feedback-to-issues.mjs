// Turns "Request a change" submissions (Firestore feedback/{id}) into GitHub issues.
// Runs in GitHub Actions (see .github/workflows/feedback-to-issues.yml).
// Reads Firestore with the app's public API key (the rules allow reading
// feedback), and creates issues with the workflow's GITHUB_TOKEN.
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY. Optional: DRY_RUN=1, FEEDBACK_JSON=<file>
// (a saved runQuery response, for testing without network).
import { readFileSync } from 'node:fs';

const MAX_PER_RUN = 10;
const LOOKBACK_DAYS = 3;
const LABEL = 'feedback';

const cfg = readFileSync(new URL('../../public/js/config.js', import.meta.url), 'utf8');
const pick = (k) => (cfg.match(new RegExp(`${k}:\\s*"([^"]*)"`)) || [])[1];
const apiKey = pick('apiKey');
const projectId = pick('projectId');
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const dry = process.env.DRY_RUN === '1';

async function loadFeedback() {
  if (process.env.FEEDBACK_JSON) return JSON.parse(readFileSync(process.env.FEEDBACK_JSON, 'utf8'));
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'feedback' }],
          where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since } } },
          orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
          limit: 200,
        },
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = Array.isArray(body) ? body[0]?.error : body.error;
    if (err?.status === 'PERMISSION_DENIED') {
      console.log('::warning::Firestore refused to list feedback. Paste the latest firestore.rules into the Firebase console.');
      return null;
    }
    throw new Error(`Firestore ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

function parse(rows) {
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const f = r.document.fields || {};
      return {
        id: r.document.name.split('/').pop(),
        text: f.text?.stringValue || '',
        kind: f.kind?.stringValue === 'bug' ? 'bug' : 'idea',
        screen: f.screen?.stringValue || '',
        createdAt: f.createdAt?.timestampValue || '',
      };
    })
    .filter((d) => d.text.trim().length >= 10);
}

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${opts.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Ids already posted, read from the marker in each feedback issue's body.
async function postedIds() {
  const since = new Date(Date.now() - (LOOKBACK_DAYS + 1) * 864e5).toISOString();
  const ids = new Set();
  for (let page = 1; page < 20; page++) {
    const list = await gh(`/repos/${repo}/issues?labels=${LABEL}&state=all&since=${since}&per_page=100&page=${page}`);
    for (const i of list) for (const m of (i.body || '').matchAll(/feedback-id:\s*([A-Za-z0-9]+)/g)) ids.add(m[1]);
    if (list.length < 100) break;
  }
  return ids;
}

// Keep user text from pinging people, linking issues or breaking out of the quote.
const neutral = (s) => s.replace(/\r/g, '').replace(/@/g, '@​').replace(/#(\d)/g, '#​$1').replace(/<!--|-->/g, '');

export function issueFor(d) {
  const oneLine = neutral(d.text).replace(/\s+/g, ' ').trim();
  const title = (d.kind === 'bug' ? 'Bug: ' : 'Idea: ') + (oneLine.length > 72 ? oneLine.slice(0, 70).trimEnd() + '…' : oneLine);
  const body = [
    'Submitted from the website with **Request a change**.',
    '',
    neutral(d.text).split('\n').map((l) => '> ' + l).join('\n'),
    '',
    `Kind: ${d.kind}${d.screen ? ` · Screen: ${neutral(d.screen)}` : ''} · Sent: ${d.createdAt}`,
    '',
    `<!-- feedback-id: ${d.id} -->`,
  ].join('\n');
  return { title, body, labels: [LABEL, d.kind === 'bug' ? 'bug' : 'enhancement'] };
}

async function main() {
  if (!apiKey || !projectId) { console.log('No Firebase config; nothing to do.'); return; }
  const raw = await loadFeedback();
  if (!raw) return;
  const docs = parse(raw);
  const seen = dry && !token ? new Set() : await postedIds();
  const fresh = docs.filter((d) => !seen.has(d.id));
  console.log(`${docs.length} recent requests, ${fresh.length} not posted yet.`);
  for (const d of fresh.slice(0, MAX_PER_RUN)) {
    const issue = issueFor(d);
    if (dry) { console.log(JSON.stringify(issue, null, 2)); continue; }
    const made = await gh(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify(issue) });
    console.log(`Posted #${made.number} for ${d.id}`);
  }
  if (fresh.length > MAX_PER_RUN) console.log(`${fresh.length - MAX_PER_RUN} left for the next run.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
