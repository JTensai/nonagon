import { Stage } from './stage.js';
import { computeProgress, focusRect, pathTo, countDescendants, nodeAt, contentBounds, frameOf, lowestCommonAncestor, liveChildren, NESTED_EXTENT } from './layout.js';
import { store, newId, blankNode } from './store.js';
import { $, esc, toast, sheet, closeSheet, sheetOpen, confirmSheet, menu, ICONS, isSubmitEnter } from './ui.js';
import { exportImage } from './painter.js';
import { runTour } from './tour.js';
import { getPref, setPref, openSettings, toggleTheme, isDarkNow } from './settings.js';

const MAX_TEXT = 140;
const MAX_NOTE = 2000;

export class Editor {
  constructor(root, { onExit, readOnly = false, userId }) {
    this.root = root;
    this.onExit = onExit;
    this.readOnly = readOnly;
    this.userId = userId;
    this.board = null;
    this.focusId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.saveTimer = 0;
    this.saving = false;
    this.mode = getPref('view') === 'fractal' ? 'fractal' : 'nested';

    const oldStage = $('.stage', root);
    const stageEl = oldStage.cloneNode(false); // fresh element, no old listeners
    oldStage.replaceWith(stageEl);
    this.stage = new Stage(stageEl, {
      onTap: (it) => this.tap(it),
      onLongPress: (it) => this.longPress(it),
      onTick: (id) => this.toggleDone(id),
      onNote: (id) => this.openNotes(id),
      onSettle: () => this.settle(),
    });
    this.stage.mode = this.mode;

    $('[data-act=back]', root).onclick = () => this.onExit();
    $('[data-act=up]', root).onclick = () => this.up();
    $('[data-act=overview]', root).onclick = () => this.overview();
    $('[data-act=undo]', root).onclick = () => this.undo();
    $('[data-act=redo]', root).onclick = () => this.redo();
    $('[data-act=view]', root).onclick = () => this.toggleMode();
    $('[data-act=menu]', root).onclick = (e) => this.openMenu(e.currentTarget);
    this.keyHandler = (e) => this.key(e);
    document.addEventListener('keydown', this.keyHandler);
    this.prefHandler = (e) => {
      if (e.detail.key === 'view' && this.board) this.setMode(e.detail.value, { silent: true });
      if (e.detail.key === 'accent' || e.detail.key === 'theme') this.stage.render();
    };
    window.addEventListener('nonagon:prefs', this.prefHandler);
    root.classList.toggle('read-only', readOnly);
  }

  destroy() {
    document.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('nonagon:prefs', this.prefHandler);
    this.stage.cancelAnim();
    this.stage.ro.disconnect();
    document.querySelector('.tour')?.remove();
    this.flush();
  }

  open(board, { tour } = {}) {
    this.board = board;
    this.undoStack = [];
    this.redoStack = [];
    this.focusId = board.rootId;
    this.stage.frameId = board.rootId;
    this.refresh();
    // Start zoomed out a touch, then settle onto the goal.
    const t = this.target(this.focusId);
    this.stage.flyTo({ ...t, w: t.w * 2.6 }, { instant: true });
    this.stage.flyTo(t, { speed: 1.1 }).then(() => {
      if (tour) setTimeout(() => runTour(this), 200);
    });
  }

  // ---- derived state ----------------------------------------------------
  refresh() {
    this.progress = computeProgress(this.board);
    this.stage.setBoard(this.board, this.progress, this.focusId);
    this.renderChrome();
  }

  renderChrome() {
    const b = this.board;
    const path = pathTo(b, this.focusId);
    const crumbs = $('.crumbs', this.root);
    crumbs.innerHTML = path
      .map((id, k) => {
        const last = k === path.length - 1;
        const label = esc(b.nodes[id].text || 'Untitled');
        return last
          ? `<span class="crumb current" aria-current="page">${label}</span>`
          : `<button type="button" class="crumb" data-id="${id}">${label}</button><span class="sep" aria-hidden="true">/</span>`;
      })
      .join('');
    crumbs.querySelectorAll('button[data-id]').forEach((btn) => (btn.onclick = () => this.focus(btn.dataset.id)));
    crumbs.scrollLeft = crumbs.scrollWidth;
    crumbs.classList.toggle('scrolled', crumbs.scrollLeft > 0);
    crumbs.onscroll = () => crumbs.classList.toggle('scrolled', crumbs.scrollLeft > 0);
    $('[data-act=up]', this.root).disabled = path.length <= 1;
    $('[data-act=undo]', this.root).disabled = !this.undoStack.length;
    $('[data-act=redo]', this.root).disabled = !this.redoStack.length;
    const viewBtn = $('[data-act=view]', this.root);
    viewBtn.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${this.mode === 'nested' ? ICONS.grid : ICONS.nest}</svg><span>${this.mode === 'nested' ? 'Nested' : 'Fractal'}</span>`;
    viewBtn.setAttribute('aria-label', `View style: ${this.mode}. Switch view style`);
    const p = Math.round((this.progress[b.rootId] || 0) * 100);
    $('.board-progress', this.root).style.setProperty('--p', p / 100);
    $('.board-progress span', this.root).textContent = p + '%';
  }

  // Where the camera sits when a square is open. In the nested view this is in
  // that square's own frame; in the fractal view it's in the shared space.
  target(id, all = false) {
    const V = this.stage.fitSize;
    if (this.mode === 'nested') {
      const hasKids = liveChildren(this.board, id).length > 0;
      // Wide screens show the whole chart around the open square; phones frame the open square.
      const showRing = hasKids && (all || V >= 620);
      return { cx: 0, cy: 0, w: showRing ? NESTED_EXTENT / 0.97 : 1 / 0.86, T: V * 0.6 };
    }
    const r = focusRect(this.board, id, this.mode);
    return { cx: r.x, cy: r.y, w: r.s / 0.94, T: V * 0.6 };
  }

  // ---- navigation -------------------------------------------------------
  async focus(id, opts = {}) {
    const b = this.board;
    if (!b.nodes[id]) return;
    this.focusId = id;
    this.stage.setFocus(id);
    this.renderChrome();
    this.stage.render();
    if (this.mode !== 'nested') return this.stage.flyTo(this.target(id, opts.all), opts);
    // Nested: step up to the nearest shared square, glide to the new square there,
    // then redraw around it.
    const s = this.stage;
    const from = s.frameId && b.nodes[s.frameId] ? s.frameId : b.rootId;
    const via = lowestCommonAncestor(b, from, id);
    if (via !== from) s.setFrame(via);
    const t = this.target(id, opts.all);
    const fv = frameOf(b, via), fi = frameOf(b, id);
    await s.flyTo({ cx: (fi.ox - fv.ox) / fv.sc, cy: (fi.oy - fv.oy) / fv.sc, w: (t.w * fi.sc) / fv.sc, T: t.T }, opts);
    if (this.focusId === id) s.setFrame(id);
  }

  up() {
    const n = this.board.nodes[this.focusId];
    if (n?.parent) this.focus(n.parent);
    else this.focus(this.board.rootId);
  }

  overview() {
    if (this.mode === 'nested') { this.focus(this.board.rootId, { all: true }); return; }
    const V = this.stage.fitSize;
    const r = contentBounds(this.board, this.mode);
    this.stage.flyTo({ cx: r.x, cy: r.y, w: r.s / 0.95, T: Math.max(84, V * 0.17) });
  }

  // After a free pinch/pan in the fractal view, follow along with whatever square is now in view.
  settle() {
    if (this.mode === 'nested') return;
    const c = this.stage.cam;
    const id = nodeAt(this.board, this.mode, c.cx, c.cy, c.w * 0.62);
    if (id !== this.focusId) {
      this.focusId = id;
      this.stage.setFocus(id);
      this.stage.render();
      this.renderChrome();
    }
  }

  setMode(mode, { silent } = {}) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.stage.mode = mode;
    this.stage.frameId = this.focusId;
    // Keep the same square in view: frame it instantly in the new geometry, fade, and settle.
    const t = this.target(this.focusId);
    this.stage.flyTo({ ...t, w: t.w * 1.2 }, { instant: true });
    this.stage.world.animate(
      [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
    this.stage.flyTo(t);
    this.renderChrome();
    if (!silent) toast(mode === 'nested' ? 'Nested view: each step\u2019s grid sits around the open square' : 'Fractal view: every square holds its own smaller grid');
  }

  toggleMode() {
    const mode = this.mode === 'nested' ? 'fractal' : 'nested';
    setPref('view', mode);
    this.setMode(mode);
  }

  // ---- taps -------------------------------------------------------------
  tap(it) {
    if (it.kind === 'node') {
      if (it.nodeId === this.focusId) {
        if (it.role === 'center' || it.role === 'card') this.editNode(it.nodeId);
        else this.focus(it.nodeId); // focus node seen in its parent's block
        return;
      }
      this.focus(it.nodeId);
    } else if (it.kind === 'empty') {
      if (this.readOnly) { this.focus(it.parentId); return; }
      if (it.parentId === this.focusId) this.addNode(it.parentId, it.slot);
      else this.focus(it.parentId);
    } else if (it.kind === 'block' || it.kind === 'frame' || it.kind === 'blob') {
      this.focus(it.nodeId);
    }
  }

  longPress(it) {
    if (this.readOnly) return;
    if (it.kind === 'node') this.editNode(it.nodeId);
    else if (it.kind === 'empty') this.addNode(it.parentId, it.slot);
  }

  key(e) {
    if (!this.root.classList.contains('active') || sheetOpen()) return;
    if (e.target.closest?.('input, textarea')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    else if (e.key === 'Escape' || e.key === 'Backspace') { if (e.key === 'Escape' || !mod) { e.preventDefault(); this.up(); } }
    else if (e.key === 'o' || e.key === '0') this.overview();
    else if (e.key === 'v') this.toggleMode();
    else if (e.key === 'e' && !this.readOnly) this.editNode(this.focusId);
  }

  // ---- editing ----------------------------------------------------------
  snapshot() {
    return JSON.stringify({ nodes: this.board.nodes, title: this.board.title, focus: this.focusId });
  }
  commit(label) {
    this.undoStack.push({ s: this._before, label });
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.board.updatedAt = Date.now();
    const wasDone = this._rootDone;
    this.refresh();
    const nowDone = (this.progress[this.board.rootId] || 0) >= 1;
    if (nowDone && !wasDone) {
      setTimeout(() => this.stage.celebrate(this.board.rootId), 120);
      toast('Goal complete. Every square is done.');
    }
    this.scheduleSave();
  }
  begin() {
    this._before = this.snapshot();
    this._rootDone = (computeProgress(this.board)[this.board.rootId] || 0) >= 1;
  }
  restore(s) {
    const d = JSON.parse(s);
    this.board.nodes = d.nodes;
    this.board.title = d.title;
    if (!this.board.nodes[this.focusId]) this.focusId = this.board.nodes[d.focus] ? d.focus : this.board.rootId;
  }
  undo() {
    if (this.readOnly) return;
    const e = this.undoStack.pop();
    if (!e) return;
    this.redoStack.push({ s: this.snapshot(), label: e.label });
    this.restore(e.s);
    this.board.updatedAt = Date.now();
    this.refresh();
    this.scheduleSave();
    toast(`Undid ${e.label}`);
  }
  redo() {
    if (this.readOnly) return;
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push({ s: this.snapshot(), label: e.label });
    this.restore(e.s);
    this.board.updatedAt = Date.now();
    this.refresh();
    this.scheduleSave();
    toast(`Redid ${e.label}`);
  }

  setText(id, text) {
    this.begin();
    this.board.nodes[id].text = text;
    if (id === this.board.rootId) this.board.title = text;
    this.commit('edit');
  }

  toggleDone(id) {
    if (this.readOnly) return;
    const n = this.board.nodes[id];
    this.begin();
    const wasComplete = (this.progress[id] || 0) >= 1;
    if (wasComplete && !n.done) {
      toast('This is done because all of its steps are done. Reopen a step to reopen it.');
      return;
    }
    n.done = !wasComplete;
    this.commit(n.done ? 'marking done' : 'reopening');
  }

  addNode(parentId, slot) {
    if (this.readOnly) return;
    const parent = this.board.nodes[parentId];
    this.textSheet({
      title: 'Add a step',
      hint: `Something that gets you closer to “${parent.text}”.`,
      value: '',
      submit: 'Add step',
      onSubmit: (text) => {
        this.begin();
        const id = newId();
        this.board.nodes[id] = blankNode(id, text, parentId);
        parent.children[slot] = id;
        this.stage.born.add(id);
        this.commit('adding a step');
      },
    });
  }

  editNode(id) {
    if (this.readOnly) return;
    const n = this.board.nodes[id];
    const isRoot = id === this.board.rootId;
    const descendants = countDescendants(this.board, id);
    const complete = (this.progress[id] || 0) >= 1;
    this.textSheet({
      title: isRoot ? 'Edit goal' : 'Edit step',
      value: n.text,
      submit: 'Save',
      extra: `
        <div class="sheet-row">
          <button type="button" class="btn ghost" data-x="done">${complete ? 'Mark not done' : 'Mark done'}</button>
          <button type="button" class="btn ghost" data-x="notes">${n.note ? 'Edit notes' : 'Add notes'}</button>
          ${isRoot ? '' : `<button type="button" class="btn ghost danger-text" data-x="delete">Delete${descendants ? ` (+${descendants})` : ''}</button>`}
        </div>`,
      onSubmit: (text) => { if (text !== n.text) this.setText(id, text); },
      onExtra: (x, close) => {
        close();
        if (x === 'done') this.toggleDone(id);
        if (x === 'notes') this.openNotes(id);
        if (x === 'delete') this.deleteNode(id);
      },
    });
  }

  setNote(id, note) {
    this.begin();
    if (note) this.board.nodes[id].note = note;
    else delete this.board.nodes[id].note;
    this.commit('editing notes');
  }

  openNotes(id) {
    const n = this.board.nodes[id];
    if (!n) return;
    if (this.readOnly) {
      if (!n.note) return;
      const s = sheet({
        title: 'Notes',
        body: `<p class="sheet-text">${esc(n.text)}</p><p class="notes-text">${esc(n.note)}</p>
          <div class="sheet-actions"><button type="button" class="btn primary" data-x="close">Close</button></div>`,
      });
      s.el.querySelector('[data-x=close]').onclick = () => s.close();
      return;
    }
    const s = sheet({
      title: 'Notes',
      body: `
        <form class="text-form">
          <p class="sheet-text">${esc(n.text)}</p>
          <div class="field notes-field">
            <textarea rows="6" maxlength="${MAX_NOTE}" aria-label="Notes" placeholder="Details, links, ideas, anything worth remembering">${esc(n.note || '')}</textarea>
            <span class="count"></span>
          </div>
          <div class="sheet-actions">
            <button type="button" class="btn ghost" data-x="cancel">Cancel</button>
            <button type="submit" class="btn primary">Save notes</button>
          </div>
        </form>`,
    });
    const ta = s.el.querySelector('textarea');
    const count = s.el.querySelector('.count');
    const upd = () => { count.textContent = `${ta.value.length}/${MAX_NOTE}`; };
    upd();
    ta.addEventListener('input', upd);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 80);
    s.el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const note = ta.value.trim();
      s.close(true);
      if (note !== (n.note || '')) {
        this.setNote(id, note);
        toast(note ? 'Notes saved' : 'Notes removed');
      }
    };
    s.el.querySelector('[data-x=cancel]').onclick = () => s.close();
  }

  async deleteNode(id) {
    const n = this.board.nodes[id];
    const count = countDescendants(this.board, id);
    if (count > 0) {
      const ok = await confirmSheet({
        title: 'Delete this step?',
        message: `“${n.text}” and the ${count} step${count === 1 ? '' : 's'} inside it will be removed.`,
      });
      if (!ok) return;
    }
    this.begin();
    const parent = this.board.nodes[n.parent];
    const remove = (nid) => {
      for (const c of this.board.nodes[nid].children) if (c && this.board.nodes[c]) remove(c);
      delete this.board.nodes[nid];
    };
    remove(id);
    parent.children = parent.children.map((c) => (c === id ? null : c));
    const refocus = !this.board.nodes[this.focusId];
    this.commit('deleting a step');
    if (refocus) this.focus(n.parent);
    toast('Step deleted', { label: 'Undo', run: () => this.undo() });
  }

  textSheet({ title, hint, value, submit, extra = '', onSubmit, onExtra }) {
    const s = sheet({
      title,
      body: `
        <form class="text-form">
          ${hint ? `<p class="sheet-text">${esc(hint)}</p>` : ''}
          <div class="field">
            <textarea rows="3" maxlength="${MAX_TEXT}" aria-label="${esc(title)}" placeholder="Write it in a few words" autofocus>${esc(value)}</textarea>
            <span class="count"></span>
          </div>
          ${extra}
          <div class="sheet-actions">
            <button type="button" class="btn ghost" data-x="cancel">Cancel</button>
            <button type="submit" class="btn primary">${esc(submit)}</button>
          </div>
        </form>`,
    });
    const ta = s.el.querySelector('textarea');
    const count = s.el.querySelector('.count');
    const upd = () => { count.textContent = `${ta.value.length}/${MAX_TEXT}`; };
    upd();
    ta.addEventListener('input', upd);
    ta.addEventListener('keydown', (e) => {
      if (isSubmitEnter(e)) { e.preventDefault(); s.el.querySelector('form').requestSubmit(); }
    });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 80);
    s.el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const text = ta.value.replace(/\s+/g, ' ').trim();
      if (!text) { ta.classList.add('shake'); setTimeout(() => ta.classList.remove('shake'), 400); return; }
      s.close(true);
      onSubmit(text);
    };
    s.el.querySelector('[data-x=cancel]').onclick = () => s.close();
    s.el.querySelectorAll('.sheet-row [data-x]').forEach((b) => (b.onclick = () => onExtra(b.dataset.x, () => s.close(true))));
  }

  // ---- saving -----------------------------------------------------------
  scheduleSave() {
    if (this.readOnly) return;
    this.setSaveState('Saving…');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 600);
  }
  async flush() {
    if (!this.saveTimer || this.readOnly || !this.board) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    try {
      await store.saveBoard(this.board);
      this.setSaveState('Saved');
    } catch (err) {
      console.error(err);
      this.setSaveState('Not saved');
      toast('Couldn’t save. Check your connection; your changes are kept on this screen.', { label: 'Retry', run: () => this.scheduleSave() });
    }
  }
  setSaveState(t) {
    const el = $('.save-state', this.root);
    el.textContent = t;
    el.classList.toggle('bad', t === 'Not saved');
  }

  // ---- menu -------------------------------------------------------------
  openMenu(anchor) {
    const items = [];
    if (!this.readOnly) {
      items.push({ label: 'Edit goal', icon: ICONS.edit, run: () => this.editNode(this.board.rootId) });
      items.push({ label: 'Share', icon: ICONS.share, run: () => this.share() });
    }
    // Embedded previews can't download files or open the print dialog.
    let framed = true;
    try { framed = window.self !== window.top; } catch {}
    if (!framed) {
      items.push({ label: 'Download image', icon: ICONS.image, run: () => this.download() });
      items.push({ label: 'Print', icon: ICONS.print, run: () => this.print() });
    }
    items.push({ label: isDarkNow() ? 'Light mode' : 'Dark mode', icon: isDarkNow() ? ICONS.sun : ICONS.moon, run: () => toggleTheme() });
    items.push({ label: 'Settings', icon: ICONS.settings, run: () => openSettings() });
    if (!this.readOnly) {
      items.push({ label: 'Show the tour', icon: ICONS.help, run: () => { this.focus(this.board.rootId).then(() => runTour(this)); } });
      items.push('-');
      items.push({ label: 'Delete goal', icon: ICONS.trash, danger: true, run: () => this.deleteBoard() });
    }
    menu(anchor, items);
  }

  async deleteBoard() {
    const ok = await confirmSheet({
      title: 'Delete this goal?',
      message: `“${this.board.title}” and every step in it will be permanently deleted.`,
      confirm: 'Delete goal',
    });
    if (!ok) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    await store.deleteBoard(this.board.id);
    toast('Goal deleted');
    this.onExit();
  }

  async download() {
    const { url } = await exportImage(this.board, this.mode);
    const a = document.createElement('a');
    a.href = url;
    a.download = (this.board.title || 'goal').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + '.png';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Image downloaded');
  }

  async print() {
    const { canvas } = await exportImage(this.board, this.mode);
    const img = $('#print-sheet img');
    $('#print-sheet h1').textContent = this.board.title;
    img.src = canvas.toDataURL('image/png');
    await img.decode().catch(() => {});
    window.print();
  }

  share() {
    if (!store.supportsSharing) {
      sheet({
        title: 'Share',
        body: `<p class="sheet-text">Sharing turns on once the app is connected to Firebase. In demo mode, goals live only in this browser.</p>
          <div class="sheet-actions"><button type="button" class="btn primary" data-x="ok">OK</button></div>`,
      }).el.querySelector('[data-x=ok]').onclick = () => closeSheet();
      return;
    }
    const url = `${location.origin}${location.pathname}?view=${encodeURIComponent(this.board.id)}`;
    const s = sheet({
      title: 'Share',
      body: `
        <label class="switch-row">
          <span><strong>Anyone with the link can view</strong><small>They can look and zoom around, but can’t edit.</small></span>
          <input type="checkbox" role="switch" ${this.board.public ? 'checked' : ''}>
        </label>
        <div class="link-row" ${this.board.public ? '' : 'hidden'}>
          <input type="text" readonly value="${esc(url)}" aria-label="Share link">
          <button type="button" class="btn primary" data-x="copy">Copy link</button>
        </div>`,
    });
    const box = s.el.querySelector('input[type=checkbox]');
    const row = s.el.querySelector('.link-row');
    box.onchange = () => {
      this.board.public = box.checked;
      row.hidden = !box.checked;
      this.board.updatedAt = Date.now();
      this.scheduleSave();
      toast(box.checked ? 'Link sharing on' : 'Link sharing off');
    };
    s.el.querySelector('[data-x=copy]').onclick = async () => {
      try {
        if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: this.board.title, url });
        else { await navigator.clipboard.writeText(url); toast('Link copied'); }
      } catch {
        s.el.querySelector('.link-row input').select();
      }
    };
  }
}
