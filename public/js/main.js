import { firebaseEnabled } from './firebase.js';
import { store } from './store.js';
import { watchAuth, bindAuthScreen, bindVerifyScreen, needsVerify, signOut } from './auth.js';
import { Home } from './home.js';
import { Editor } from './editor.js';
import { tourSeen } from './tour.js';
import { $, $$, toast, closeSheet } from './ui.js';

const screens = ['auth', 'verify', 'home', 'editor', 'loading', 'missing'];
function show(name) {
  for (const s of screens) {
    const el = $('#screen-' + s);
    const on = s === name;
    el.classList.toggle('active', on);
    el.hidden = !on;
  }
  document.body.dataset.screen = name;
}

let user = null;
let editor = null;
const home = new Home($('#screen-home'), {
  onOpen: (b, o) => openBoard(b, o),
  onSignOut: async () => {
    if (user?.demo) { user = null; show('auth'); history.replaceState(null, '', location.pathname); return; }
    await signOut();
  },
});

async function openBoard(board, { fresh, replace } = {}) {
  closeSheet();
  editor?.destroy();
  editor = new Editor($('#screen-editor'), { onExit: () => history.back(), userId: user?.uid });
  show('editor');
  const url = `#/g/${board.id}`;
  if (replace) history.replaceState({ board: board.id }, '', url);
  else history.pushState({ board: board.id }, '', url);
  editor.open(board, { tour: fresh && !tourSeen() });
}

async function route() {
  if (!user) return;
  const m = location.hash.match(/^#\/g\/(.+)$/);
  if (m) {
    if (editor && editor.board?.id === m[1] && $('#screen-editor').classList.contains('active')) return;
    const b = await store.getBoard(decodeURIComponent(m[1])).catch(() => null);
    if (b && b.ownerId === user.uid) {
      editor?.destroy();
      editor = new Editor($('#screen-editor'), { onExit: () => goHome(), userId: user.uid });
      show('editor');
      editor.open(b);
      return;
    }
  }
  goHome(true);
}

function goHome(replace) {
  editor?.destroy();
  editor = null;
  closeSheet();
  if (replace && location.hash) history.replaceState(null, '', location.pathname + location.search);
  show('home');
  home.start(user);
}

addEventListener('popstate', () => {
  if (!user) return;
  if (!location.hash) goHome();
  else route();
});

function signedIn(u) {
  user = u;
  route();
}

// ---- read-only shared view -------------------------------------------------
async function viewShared(id) {
  show('loading');
  try {
    const b = await store.getBoard(id);
    if (!b) throw new Error('missing');
    editor = new Editor($('#screen-editor'), { onExit: () => { location.href = location.pathname; }, readOnly: true });
    show('editor');
    editor.open(b);
  } catch (e) {
    console.warn(e);
    show('missing');
  }
}

// ---- sign-in hero: the chart assembles from the goal outward ---------------
function buildHero() {
  const host = $('.hero-grid');
  if (!host || host.childElementCount) return;
  const done = new Set([2, 9, 13, 21, 27, 30, 46, 52, 56, 62, 71]);
  const empty = new Set([7, 17, 25, 63, 69, 75, 79]);
  for (let b = 0; b < 9; b++) {
    const block = document.createElement('div');
    block.className = 'hb';
    const bx = b % 3, by = Math.floor(b / 3);
    for (let c = 0; c < 9; c++) {
      const cx = c % 3, cy = Math.floor(c / 3);
      const gx = bx * 3 + cx, gy = by * 3 + cy;
      const i = document.createElement('i');
      const k = gy * 9 + gx;
      const isCore = b === 4 && c === 4;
      const isBlockCenter = c === 4 || b === 4;
      if (isCore) i.className = 'c';
      else if (isBlockCenter && (c === 4 && b !== 4)) i.className = 'sub';
      else if (done.has(k)) i.className = 'done';
      else if (empty.has(k)) i.className = 'empty';
      // order: core, then the 8 steps around it, then each step's block
      const d = isCore ? 0 : b === 4 ? 1 + Math.hypot(cx - 1, cy - 1) * 0.6 : 2.6 + Math.hypot(bx - 1, by - 1) * 0.5 + (c === 4 ? 0 : 0.5 + Math.hypot(cx - 1, cy - 1) * 0.35);
      i.style.setProperty('--d', (d * 0.16).toFixed(3) + 's');
      block.append(i);
    }
    host.append(block);
  }
}
buildHero();

// ---- boot ------------------------------------------------------------------
bindAuthScreen({ onDemo: () => signedIn({ uid: 'demo', demo: true }) });
if (firebaseEnabled) bindVerifyScreen({ onVerified: (u) => signedIn(u) });

const params = new URLSearchParams(location.search);
const shared = params.get('view');
document.body.classList.toggle('demo-mode', !firebaseEnabled);

if (shared && firebaseEnabled) {
  viewShared(shared);
} else if (!firebaseEnabled) {
  show('auth');
} else {
  show('loading');
  watchAuth((u) => {
    if (!u) {
      user = null;
      home.stop();
      editor?.destroy();
      editor = null;
      show('auth');
      return;
    }
    if (needsVerify(u)) {
      user = null;
      $('#screen-verify .verify-email').textContent = u.email;
      show('verify');
      return;
    }
    if (user?.uid === u.uid) return;
    signedIn(u);
  }).catch((e) => {
    console.error(e);
    toast('Couldn’t load sign-in. Check your connection and reload.');
    show('auth');
  });
}

void $$;
