# Nonagon

A goal-planning web app. The user writes a goal in the middle of a 3×3 grid, surrounds it with 8 steps, and each step becomes the middle of its own grid, recursively, until every square is doable. Zoom out to see everything, tap a square to dive in. Wonderfully animated, calm and premium.

- **Live site:** https://jtensai.github.io/nonagon/
- **Repo:** https://github.com/JTensai/nonagon (branch `main`)
- **Owner:** Nasa (GitHub: JTensai). Communicates from a phone a lot; keep replies short and lead with the answer.

## How it's built

Plain HTML, CSS and JavaScript ES modules. **No build step, no framework, no npm dependencies** in the app. Keep it that way unless there's a strong reason.

- **Hosting:** GitHub Pages. `.github/workflows/pages.yml` publishes `public/` on every push to `main` (takes about a minute). Pushing to `main` is the deploy.
- **Backend:** Firebase project `nonagon-64006` (free Spark plan). Firebase Auth for sign-in, Cloud Firestore for data. The Firebase JS SDK is loaded on demand from gstatic (`FIREBASE_SDK_VERSION` in `public/js/config.js`). Firebase Hosting is not used.
- **Demo mode:** if `firebaseConfig.apiKey` is empty, the app runs with no sign-in and saves to `localStorage`. Used for local testing and the claude.ai preview copy.

### Files

| File | Role |
| --- | --- |
| `public/index.html` | All screens: loading, sign-in, verify email, goals list, board, shared-link-missing |
| `public/css/app.css` | Design tokens (light + dark), all component styles |
| `public/js/main.js` | Boot, routing (`#/g/<boardId>`, `?view=<boardId>` for shared read-only links), auth state |
| `public/js/layout.js` | Grid geometry for both views, progress roll-up |
| `public/js/stage.js` | Renders tiles as positioned DOM elements with level of detail; tap, long-press, drag, pinch, wheel; camera flights; frame switching for the nested view |
| `public/js/camera.js` | Smooth zoom/pan path (van Wijk & Nuij) |
| `public/js/editor.js` | Board screen: navigation, add/edit/delete/tick, undo/redo, debounced saving, share, export, menu |
| `public/js/home.js` | Goals list with canvas thumbnails, new goal, example goal |
| `public/js/auth.js` | Google, Facebook, email/password sign-in, email verification, password reset |
| `public/js/store.js` | `CloudStore` (Firestore) and `LocalStore` (demo); board factory and example board |
| `public/js/settings.js` | Per-device prefs: theme (system/light/dark), accent color, default view. Derives `--moss`, `--moss-2`, `--moss-ink` from the accent |
| `public/js/painter.js` | Draws a board to canvas for thumbnails, PNG download and print |
| `public/js/tour.js` | 5-step first-run tour with spotlight |
| `public/js/ui.js` | Toasts, bottom sheets / dialogs, confirm, popover menus, icons |
| `public/privacy.html` | Privacy policy (needed by Meta); contact football80+nonagon@gmail.com |
| `firestore.rules` | Security rules (also pasted into the Firebase console by hand) |
| `firebase.json`, `.firebaserc`, `scripts/setup.sh` | Firebase CLI setup for anyone recreating the backend from a computer |

### Data model

One Firestore document per goal: `boards/{boardId}` with `ownerId, title, rootId, nodes, public, createdAt, updatedAt`. `nodes` is a map of `{ id, text, done, parent, children: [8 ids or null] }`. Child slots 0–7 map to grid positions `[0,1,2,3,5,6,7,8]` (4 is the centre). A node's progress is 1 if `done`, otherwise the average of its children. Rules: owners read/write their own boards; anyone can read a board with `public == true`; email/password users must verify their email before saving.

### The two views

- **Nested** (default): drawn relative to the open square (the "frame"). The open square's 3×3 block sits in the middle at size 1; each step's own 3×3 block surrounds it at `RING = 0.8` of that size (user asked for 80%). Each node's frame has a fixed place in one shared space (`frameOf()`), so moving between squares is a coordinate change: step up to the lowest common ancestor frame, fly the camera, then switch to the new frame. Tiles shared by both frames stay put, the rest fade. Cells in the outer blocks with steps of their own show a tiny dot map ("peek").
- **Fractal**: every node owns a square region; children fill the 8 surrounding thirds, recursively at 3× per level. Cards subdivide into their own grid once big enough on screen (crossfade around threshold `T`). Empty leaves stay cards unless open.

Wide screens (fit size ≥ 620px) show the whole nested chart; phones frame the open grid and use **All** to see the rest.

## Design

- Typeface: Hanken Grotesk (Google Fonts).
- Neutral greys so any accent works. Default accent is **salmon `#F08C7B`** (user's choice). Gold (`--brass`) marks progress and done squares. Accent token names are still `--moss*` for historical reasons.
- Light and dark themes defined at token level: bare `:root` = light, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]` = dark.
- Motion: camera glides, new tiles spring in, done tiles pop, a ripple when the whole goal hits 100%. Respect `prefers-reduced-motion`.
- Copy: plain, sentence case, active verbs, errors say what to do.

## Working on it

- **Test before pushing** with headless Chromium (Python Playwright is available in Claude's cloud workspace). Serve `public/` with `python3 -m http.server`, and route `**/js/config.js` to an empty-`apiKey` config to test in demo mode. Check phone (390×844) and desktop widths, light and dark, and that there are no console errors.
- **Deploy:** commit and push to `main`; check the Actions run succeeded.
- A demo-mode preview copy is also published as a claude.ai artifact; republish it after visible changes if asked.
- Sign-in can't be tested from Claude's cloud workspace (Google APIs are blocked there); ask Nasa to test on the live site.

## Status (Oct 18, 2026)

Done: both views, zoom/dive animations, progress roll-up, many goals per user, link sharing (view only), PNG download and print, undo/redo, first-run tour, Settings (theme, color, default view), Google and email sign-in live on Firebase.

Open items:
- **Facebook login is not finished.** Meta wants the app connected to a verified business portfolio. Nasa doesn't want to tie it to Tricks Folsom's portfolio or give out more personal info for a small app. Likely decision: skip it and hide the Facebook button on the sign-in screen (`[data-provider=facebook]` in `index.html`). Ask before removing.
- The app icon uploaded to Meta is the old green version; `public/icon-1024.png` is also still green. Regenerate in salmon if Facebook continues.

## Bigger goal

Nasa wants a repeatable **prompt → live URL** process for small standalone apps. Plan discussed: one-time sign-ins and setup, then each new app is built, tested, pushed to GitHub Pages and handed back as a link, with a shared Firebase project when a backend is needed. Meta/Facebook login always needs manual dashboard work and business verification, so default to Google + email sign-in.
