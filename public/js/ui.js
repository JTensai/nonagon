// Small UI helpers: toasts, bottom sheets, confirm, popover menu.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(message, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => { hide(); action.run(); };
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  const hide = () => el.classList.remove('show');
  toastTimer = setTimeout(hide, action ? 6000 : 2600);
}

// Bottom sheet (dialog on desktop). Returns { el, close }.
let openSheet = null;
export function sheet({ title, body, onClose, wide }) {
  closeSheet();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('div');
  el.className = 'sheet' + (wide ? ' wide' : '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="grab" aria-hidden="true"></div>${title ? `<h2 class="sheet-title">${esc(title)}</h2>` : ''}`;
  if (typeof body === 'string') el.insertAdjacentHTML('beforeend', body);
  else el.append(body);
  document.body.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); });
  const prevFocus = document.activeElement;
  const close = (silent) => {
    if (!el.isConnected) return;
    scrim.classList.remove('show');
    el.classList.remove('show');
    setTimeout(() => { scrim.remove(); el.remove(); }, 260);
    if (openSheet && openSheet.el === el) openSheet = null;
    document.removeEventListener('keydown', onKey, true);
    prevFocus?.focus?.({ preventScroll: true });
    if (!silent) onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  scrim.onclick = () => close();
  openSheet = { el, close };
  setTimeout(() => {
    const f = el.querySelector('[autofocus], textarea, input, button.primary');
    f?.focus({ preventScroll: true });
  }, 60);
  return { el, close };
}
export function closeSheet() { openSheet?.close(true); }
export function sheetOpen() { return !!openSheet; }

export function confirmSheet({ title, message, confirm = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({
      title,
      body: `<p class="sheet-text">${esc(message)}</p>
        <div class="sheet-actions"><button type="button" class="btn ghost" data-a="no">Cancel</button>
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-a="yes" autofocus>${esc(confirm)}</button></div>`,
      onClose: () => { if (!done) resolve(false); },
    });
    s.el.querySelector('[data-a=no]').onclick = () => { done = true; s.close(true); resolve(false); };
    s.el.querySelector('[data-a=yes]').onclick = () => { done = true; s.close(true); resolve(true); };
  });
}

// Popover menu anchored to a button.
export function menu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === '-') { el.insertAdjacentHTML('beforeend', '<hr>'); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = it.danger ? 'danger' : '';
    b.innerHTML = `${it.icon ? `<svg viewBox="0 0 20 20" aria-hidden="true">${it.icon}</svg>` : ''}<span>${esc(it.label)}</span>`;
    b.onclick = () => { close(); it.run(); };
    el.append(b);
  }
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.top = r.bottom + 8 + 'px';
  el.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)) + 'px';
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); };
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    el.querySelector('button')?.focus();
  });
}

export const ICONS = {
  share: '<path d="M10 3v9M6.5 6.5L10 3l3.5 3.5M5 10v6h10v-6"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 13l4-4 4 4 2-2 4 4"/>',
  print: '<path d="M6 7V3h8v4M6 14H4V8h12v6h-2M6 11h8v6H6z"/>',
  edit: '<path d="M4 16l1-4 8-8 3 3-8 8-4 1zM11 6l3 3"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/>',
  grid: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7.7 3v14M12.3 3v14M3 7.7h14M3 12.3h14"/>',
  nest: '<rect x="3" y="3" width="14" height="14" rx="2"/><rect x="7.5" y="7.5" width="5" height="5" rx="1"/><path d="M10 3v4.5M10 12.5V17M3 10h4.5M12.5 10H17"/>',
  help: '<circle cx="10" cy="10" r="7"/><path d="M8 8a2 2 0 113 1.7c-.7.4-1 .8-1 1.6M10 14h0"/>',
  out: '<path d="M8 4H4v12h4M12 6l4 4-4 4M16 10H8"/>',
};
