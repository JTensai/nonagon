// Per-device settings: light/dark theme, accent color, default view.
import { sheet, esc, toast } from './ui.js';

const KEY = 'nonagon.prefs';
const DEFAULTS = { theme: 'system', accent: '#F08C7B', view: 'nested' };

export const ACCENTS = [
  { name: 'Salmon', hex: '#F08C7B' },
  { name: 'Rose', hex: '#E27D9F' },
  { name: 'Amber', hex: '#E3A54A' },
  { name: 'Sage', hex: '#86AE8A' },
  { name: 'Forest', hex: '#3F7A5E' },
  { name: 'Teal', hex: '#3E97A3' },
  { name: 'Blue', hex: '#5C7FE0' },
  { name: 'Plum', hex: '#9C72C9' },
];

let prefs = load();

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // carry over the view choice saved by earlier versions
    if (!saved.view) saved.view = localStorage.getItem('nonagon.view') || undefined;
  } catch {}
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(saved).filter(([, v]) => v)) };
}

export const getPref = (k) => prefs[k];

export function setPref(k, v) {
  prefs = { ...prefs, [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  apply();
  window.dispatchEvent(new CustomEvent('nonagon:prefs', { detail: { key: k, value: v } }));
}

// ---- color math -------------------------------------------------------------
const hexToRgb = (h) => {
  const m = h.replace('#', '');
  const n = parseInt(m.length === 3 ? m.replace(/./g, (c) => c + c) : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r) => '#' + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
const luminance = (h) => {
  const [r, g, b] = hexToRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export function accentTokens(hex) {
  const dark = mix(hex, '#000000', 0.78);
  const ink = contrast(hex, '#FFFFFF') >= contrast(hex, dark) ? '#FFFFFF' : dark;
  const hover = luminance(hex) > 0.35 ? mix(hex, '#000000', 0.08) : mix(hex, '#FFFFFF', 0.12);
  return { accent: hex, hover, ink };
}

export function apply() {
  const root = document.documentElement;
  if (prefs.theme === 'light' || prefs.theme === 'dark') root.dataset.theme = prefs.theme;
  else delete root.dataset.theme;
  const t = accentTokens(prefs.accent);
  root.style.setProperty('--moss', t.accent);
  root.style.setProperty('--moss-2', t.hover);
  root.style.setProperty('--moss-ink', t.ink);
  const isDark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => m.setAttribute('content', isDark ? '#141518' : '#ECECEE'));
}

export function isDarkNow() {
  return prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

export function toggleTheme() {
  setPref('theme', isDarkNow() ? 'light' : 'dark');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => apply());

// ---- settings screen ----------------------------------------------------------
export function openSettings() {
  const seg = (name, value, options) =>
    `<div class="seg" role="radiogroup" aria-label="${esc(name)}">${options
      .map(([v, label]) => `<label><input type="radio" name="${name}" value="${v}" ${value === v ? 'checked' : ''}><span>${esc(label)}</span></label>`)
      .join('')}</div>`;
  const isPreset = ACCENTS.some((a) => a.hex.toLowerCase() === prefs.accent.toLowerCase());
  const s = sheet({
    title: 'Settings',
    body: `
      <div class="settings">
        <section>
          <h3>Appearance</h3>
          ${seg('theme', prefs.theme, [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']])}
        </section>
        <section>
          <h3>Color</h3>
          <div class="swatches" role="radiogroup" aria-label="Color">
            ${ACCENTS.map((a) => `<label class="swatch" style="--sw:${a.hex}" title="${a.name}"><input type="radio" name="accent" value="${a.hex}" ${a.hex.toLowerCase() === prefs.accent.toLowerCase() ? 'checked' : ''}><span class="dot"></span><span class="sw-name">${a.name}</span></label>`).join('')}
            <label class="swatch custom" title="Pick any color" style="--sw:${isPreset ? '#888888' : esc(prefs.accent)}">
              <input type="radio" name="accent" value="custom" ${isPreset ? '' : 'checked'}>
              <span class="dot"><input type="color" id="accent-custom" value="${esc(prefs.accent)}" aria-label="Custom color"></span><span class="sw-name">Custom</span>
            </label>
          </div>
          <div class="preview" aria-hidden="true"><i></i><i class="d"></i><i></i><i></i><i class="c"></i><i class="d"></i><i></i><i></i><i></i></div>
        </section>
        <section>
          <h3>Default view</h3>
          ${seg('view', prefs.view, [['nested', 'Nested'], ['fractal', 'Fractal']])}
          <p class="hint">Nested lays each step’s grid around the open square. Fractal tucks each grid inside its own square.</p>
        </section>
        <p class="hint">Settings are saved on this device.</p>
        <div class="sheet-actions"><button type="button" class="btn primary" data-x="done">Done</button></div>
      </div>`,
  });
  s.el.querySelectorAll('input[name=theme]').forEach((r) => (r.onchange = () => setPref('theme', r.value)));
  s.el.querySelectorAll('input[name=view]').forEach((r) => (r.onchange = () => setPref('view', r.value)));
  const custom = s.el.querySelector('#accent-custom');
  const customSwatch = s.el.querySelector('.swatch.custom');
  s.el.querySelectorAll('input[name=accent]').forEach((r) => (r.onchange = () => {
    if (r.value === 'custom') setPref('accent', custom.value);
    else setPref('accent', r.value);
  }));
  custom.addEventListener('input', () => {
    customSwatch.style.setProperty('--sw', custom.value);
    customSwatch.querySelector('input[type=radio]').checked = true;
    setPref('accent', custom.value);
  });
  s.el.querySelector('[data-x=done]').onclick = () => { s.close(); toast('Settings saved'); };
}

apply();
