// "Request a change": saves a short request to Firestore (feedback/{id}).
// A GitHub Action (.github/workflows/feedback-to-issues.yml) turns each one
// into a GitHub issue, and a daily bot decides which ones to build.
import { fire, firebaseEnabled } from './firebase.js';
import { sheet, closeSheet, toast, esc } from './ui.js';

export const MIN_TEXT = 10;
export const MAX_TEXT = 2000;

export const FEEDBACK_ICON = '<path d="M4 4.5h12a1 1 0 011 1v7a1 1 0 01-1 1H9l-4 3v-3H4a1 1 0 01-1-1v-7a1 1 0 011-1z"/><path d="M7 8.5h6M7 11h4"/>';

function info(title, text, action) {
  const s = sheet({
    title,
    body: `<p class="sheet-text">${esc(text)}</p>
      <div class="sheet-actions">${action ? `<a class="btn ghost" href="${esc(action.href)}">${esc(action.label)}</a>` : ''}
      <button type="button" class="btn primary" data-x="ok">OK</button></div>`,
  });
  s.el.querySelector('[data-x=ok]').onclick = () => closeSheet();
}

export async function openFeedback() {
  if (!firebaseEnabled) {
    info('Request a change', 'Requests turn on once the app is connected to Firebase. In demo mode there’s nowhere to send them.');
    return;
  }
  let f;
  try { f = await fire(); } catch { toast('Couldn’t connect. Check your connection and try again.'); return; }
  await f.auth.authStateReady?.();
  const u = f.auth.currentUser;
  if (!u) {
    info('Request a change', 'Sign in to send a request. It only takes a moment.', { href: './', label: 'Sign in' });
    return;
  }

  const s = sheet({
    title: 'Request a change',
    body: `
      <form class="feedback-form">
        <p class="sheet-text">Tell us what to add or fix. A bot reads every request once a day and builds the good ones into the app.</p>
        <div class="seg" role="radiogroup" aria-label="Kind of request">
          <label><input type="radio" name="kind" value="idea" checked><span>Idea</span></label>
          <label><input type="radio" name="kind" value="bug"><span>Something’s broken</span></label>
        </div>
        <div class="field">
          <textarea rows="5" maxlength="${MAX_TEXT}" aria-label="Your request" placeholder="e.g. Let me pick a color for each step" autofocus></textarea>
          <span class="count"></span>
        </div>
        <p class="hint">Requests are posted publicly on GitHub without your name. Please don’t include personal details.</p>
        <div class="sheet-actions">
          <button type="button" class="btn ghost" data-x="cancel">Cancel</button>
          <button type="submit" class="btn primary">Send</button>
        </div>
      </form>`,
  });
  const form = s.el.querySelector('form');
  const ta = form.querySelector('textarea');
  const count = form.querySelector('.count');
  const send = form.querySelector('[type=submit]');
  const update = () => {
    const n = ta.value.trim().length;
    count.textContent = n < MIN_TEXT ? `${MIN_TEXT - n} more` : `${n}/${MAX_TEXT}`;
  };
  update();
  ta.addEventListener('input', update);
  form.querySelector('[data-x=cancel]').onclick = () => s.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (text.length < MIN_TEXT) {
      ta.classList.remove('shake'); void ta.offsetWidth; ta.classList.add('shake'); ta.focus();
      return;
    }
    send.classList.add('busy');
    try {
      const { db, fs } = f;
      await fs.addDoc(fs.collection(db, 'feedback'), {
        text,
        kind: form.querySelector('input[name=kind]:checked').value,
        screen: document.body.dataset.screen || '',
        createdAt: fs.serverTimestamp(),
      });
      s.close();
      toast('Thanks. Your request is in.');
    } catch (err) {
      console.error(err);
      send.classList.remove('busy');
      toast(err?.code === 'permission-denied'
        ? 'Couldn’t send. Verify your email first, then try again.'
        : 'Couldn’t send. Check your connection and try again.');
    }
  };
}

// Any element with data-feedback opens the form.
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-feedback]');
  if (b) { e.preventDefault(); openFeedback(); }
});
