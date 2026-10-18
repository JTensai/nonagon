import { firebaseEnabled, fire } from './firebase.js';
import { $, toast } from './ui.js';

const MESSAGES = {
  'auth/invalid-credential': 'That email and password don’t match an account.',
  'auth/wrong-password': 'That email and password don’t match an account.',
  'auth/user-not-found': 'No account uses that email. Create one instead.',
  'auth/email-already-in-use': 'An account already uses this email. Sign in instead.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute, then try again.',
  'auth/network-request-failed': 'Can’t reach the server. Check your connection and try again.',
  'auth/account-exists-with-different-credential': 'You’ve signed in with this email a different way before. Use that method instead.',
  'auth/operation-not-allowed': 'This sign-in method isn’t turned on yet. Enable it in the Firebase console.',
  'auth/unauthorized-domain': 'This website isn’t on the Firebase list of authorized domains yet.',
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
};
const msg = (err) => (err?.code in MESSAGES ? MESSAGES[err.code] : err?.message || 'Something went wrong. Try again.');

export const isPasswordUser = (u) => u?.providerData?.some((p) => p.providerId === 'password');
export const needsVerify = (u) => u && isPasswordUser(u) && !u.emailVerified;

export async function watchAuth(cb) {
  if (!firebaseEnabled) return;
  const { auth, au } = await fire();
  au.getRedirectResult(auth).catch((e) => { const m = msg(e); if (m) toast(m); });
  au.onAuthStateChanged(auth, cb);
}

export async function signOut() {
  if (!firebaseEnabled) return;
  const { auth, au } = await fire();
  await au.signOut(auth);
}

async function social(kind) {
  const { auth, au } = await fire();
  const provider = kind === 'google' ? new au.GoogleAuthProvider() : new au.FacebookAuthProvider();
  if (kind === 'facebook') provider.addScope('email');
  try {
    await au.signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await au.signInWithRedirect(auth, provider);
    } else throw e;
  }
}

// Wire up the sign-in screen. onDemo() is called for "Try it without an account".
export function bindAuthScreen({ onDemo }) {
  const screen = $('#screen-auth');
  const form = $('.email-form', screen);
  const err = $('.auth-error', screen);
  const setErr = (t) => { err.textContent = t || ''; err.hidden = !t; };
  let mode = 'signin';

  const setMode = (m) => {
    mode = m;
    form.dataset.mode = m;
    $('[name=password]', form).hidden = m === 'reset';
    $('[name=password]', form).required = m !== 'reset';
    $('[name=password]', form).autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    $('.email-submit', form).textContent = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[m];
    $('.mode-links', screen).innerHTML = {
      signin: '<button type="button" data-m="signup">Create an account</button><button type="button" data-m="reset">Forgot password?</button>',
      signup: '<button type="button" data-m="signin">I already have an account</button>',
      reset: '<button type="button" data-m="signin">Back to sign in</button>',
    }[m];
    $$m();
    setErr('');
  };
  const $$m = () => screen.querySelectorAll('.mode-links [data-m]').forEach((b) => (b.onclick = () => setMode(b.dataset.m)));

  if (!firebaseEnabled) {
    screen.classList.add('demo');
    screen.querySelectorAll('.provider, .email-form input, .email-form button').forEach((b) => (b.disabled = true));
  }

  screen.querySelectorAll('.provider').forEach((b) => {
    b.onclick = async () => {
      setErr('');
      b.classList.add('busy');
      try { await social(b.dataset.provider); } catch (e) { setErr(msg(e)); } finally { b.classList.remove('busy'); }
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    setErr('');
    const email = form.email.value.trim();
    const password = form.password.value;
    const btn = $('.email-submit', form);
    btn.classList.add('busy');
    try {
      const { auth, au } = await fire();
      if (mode === 'signin') await au.signInWithEmailAndPassword(auth, email, password);
      else if (mode === 'signup') {
        const cred = await au.createUserWithEmailAndPassword(auth, email, password);
        await au.sendEmailVerification(cred.user);
      } else {
        await au.sendPasswordResetEmail(auth, email);
        toast('Reset link sent. Check your inbox.');
        setMode('signin');
      }
    } catch (e2) {
      setErr(msg(e2));
    } finally {
      btn.classList.remove('busy');
    }
  };

  $('[data-act=demo]', screen).onclick = onDemo;
  setMode('signin');
}

export function bindVerifyScreen({ onVerified }) {
  const screen = $('#screen-verify');
  $('[data-act=check]', screen).onclick = async () => {
    const { auth } = await fire();
    await auth.currentUser?.reload();
    if (auth.currentUser?.emailVerified) {
      await auth.currentUser.getIdToken(true);
      onVerified(auth.currentUser);
    } else toast('Not verified yet. Open the link in the email first.');
  };
  $('[data-act=resend]', screen).onclick = async () => {
    try {
      const { auth, au } = await fire();
      await au.sendEmailVerification(auth.currentUser);
      toast('Sent another verification email');
    } catch (e) { toast(msg(e)); }
  };
  $('[data-act=switch]', screen).onclick = () => signOut();
}
