import { $, esc, sheet, toast, menu, ICONS, isSubmitEnter } from './ui.js';
import { store, makeBoard, exampleBoard } from './store.js';
import { computeProgress, depthOf } from './layout.js';
import { paintBoard } from './painter.js';
import { openSettings, toggleTheme, isDarkNow } from './settings.js';

const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export class Home {
  constructor(root, { onOpen, onSignOut }) {
    this.root = root;
    this.onOpen = onOpen;
    this.onSignOut = onSignOut;
    this.unsub = null;
    this.thumbCache = new Map();
    $('[data-act=account]', root).onclick = (e) => this.accountMenu(e.currentTarget);
    $('[data-act=theme]', root).onclick = () => toggleTheme();
    window.addEventListener('nonagon:prefs', (e) => {
      if (e.detail.key === 'accent' || e.detail.key === 'theme') { this.thumbCache.clear(); if (this.list) this.render(); }
    });
    $('.new-goal-form', root).onsubmit = (e) => { e.preventDefault(); this.create(e.target.goal.value); };
    $('[data-act=example]', root).onclick = () => this.createExample();
  }

  async start(user) {
    this.user = user;
    $('.account-name', this.root).textContent = user.demo ? 'Menu' : (user.displayName || user.email || 'Account').split(' ')[0];
    this.root.classList.toggle('is-demo', !!user.demo);
    this.stop();
    this.list = null;
    this.render();
    this.unsub = await store.watchBoards(user.uid, (list) => { this.list = list; this.render(); }, () => {
      toast('Couldn’t load your goals. Check that Firestore rules are deployed.');
    });
  }
  stop() { if (typeof this.unsub === 'function') this.unsub(); this.unsub = null; }

  render() {
    const grid = $('.boards', this.root);
    const empty = $('.home-empty', this.root);
    const list = this.list;
    if (!list) { grid.innerHTML = '<p class="loading">Loading your goals…</p>'; empty.hidden = true; return; }
    empty.hidden = list.length > 0;
    $('.home-head', this.root).hidden = list.length === 0;
    grid.hidden = list.length === 0;
    grid.innerHTML = '';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'board-card new';
    add.innerHTML = '<span class="new-mark" aria-hidden="true"></span><span class="board-title">New goal</span>';
    add.onclick = () => this.newGoalSheet();
    grid.append(add);
    for (const b of list) {
      const p = computeProgress(b)[b.rootId] || 0;
      const steps = Object.keys(b.nodes).length - 1;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'board-card';
      card.innerHTML = `<canvas class="thumb" aria-hidden="true"></canvas>
        <span class="board-title">${esc(b.title)}</span>
        <span class="board-meta"><span class="meter" style="--p:${p.toFixed(3)}"><i></i></span>
        <span>${Math.round(p * 100)}%</span><span class="dim">${steps} step${steps === 1 ? '' : 's'}, ${depthOf(b)} level${depthOf(b) === 1 ? '' : 's'}</span>
        <span class="dim right">${fmt.format(new Date(b.updatedAt))}</span>${b.public ? '<span class="chip">Shared</span>' : ''}</span>`;
      card.onclick = () => this.onOpen(b);
      grid.append(card);
      const canvas = card.querySelector('canvas');
      const key = b.id + ':' + b.updatedAt;
      const cached = this.thumbCache.get(key);
      if (cached) canvas.getContext('2d') && drawCached(canvas, cached);
      else {
        requestAnimationFrame(() => {
          paintBoard(canvas, b, { mode: 'nested', size: 360, pad: 0.06, background: false });
          this.thumbCache.set(key, canvas);
        });
      }
    }
  }

  newGoalSheet() {
    const s = sheet({
      title: 'New goal',
      body: `<form class="text-form">
          <p class="sheet-text">Write the big thing you want to accomplish. It goes in the middle of your grid.</p>
          <div class="field"><textarea name="goal" rows="2" maxlength="140" placeholder="e.g. Open a second location" aria-label="Your goal" autofocus></textarea></div>
          <div class="sheet-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="submit" class="btn primary">Create goal</button></div>
        </form>`,
    });
    const ta = s.el.querySelector('textarea');
    ta.addEventListener('keydown', (e) => { if (isSubmitEnter(e)) { e.preventDefault(); s.el.querySelector('form').requestSubmit(); } });
    s.el.querySelector('[data-x=cancel]').onclick = () => s.close();
    s.el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      if (!ta.value.trim()) { ta.focus(); return; }
      s.close(true);
      this.create(ta.value);
    };
  }

  async create(text) {
    const goal = String(text || '').replace(/\s+/g, ' ').trim();
    if (!goal) { $('.new-goal-form textarea', this.root)?.focus(); return; }
    const b = makeBoard(this.user.uid, goal);
    try {
      await store.saveBoard(b);
      $('.new-goal-form', this.root).reset();
      this.onOpen(b, { fresh: true });
    } catch (e) {
      console.error(e);
      toast('Couldn’t create the goal. Check your connection and try again.');
    }
  }

  async createExample() {
    const b = exampleBoard(this.user.uid);
    await store.saveBoard(b);
    this.onOpen(b, { fresh: true });
  }

  accountMenu(anchor) {
    const items = [
      { label: 'Settings', icon: ICONS.settings, run: () => openSettings() },
      { label: isDarkNow() ? 'Light mode' : 'Dark mode', icon: isDarkNow() ? ICONS.sun : ICONS.moon, run: () => toggleTheme() },
      { label: 'Open an example goal', icon: ICONS.grid, run: () => this.createExample() },
      '-',
    ];
    items.push({ label: this.user.demo ? 'Leave demo' : 'Sign out', icon: ICONS.out, run: () => this.onSignOut() });
    menu(anchor, items);
  }
}

function drawCached(canvas, src) {
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext('2d').drawImage(src, 0, 0);
}
