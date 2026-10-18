# Nonagon

Put your goal in the middle of a 3×3 grid. Surround it with eight steps that get you there. Each step becomes the middle of its own grid, and you keep breaking things down until every square is something you can just do.

- **Two ways to see the whole thing.** *Nested* lays every step's grid around the goal, like a mandala chart. *Fractal* tucks each grid inside its own square. People pick the one they like; the choice is remembered.
- **Zoom anywhere.** Tap a square to dive in, use **Up** or the breadcrumbs to come back, **All** to see everything. Pinch, scroll or drag to move freely.
- **Progress that rolls up.** Tick a step and its parent's bar fills, all the way up to the goal.
- **Sign in** with Google, Facebook, or email and password (with email verification).
- **Extras:** many goals per person, link sharing (view only), image download and print, undo/redo, and a short first-run tour.

It's a static site (plain HTML, CSS and JavaScript modules, no build step) backed by Firebase Authentication and Cloud Firestore, hosted on Firebase Hosting. All of it fits in Firebase's free plan.

## Try it right now

Open `public/index.html` through any static server (for example `npx serve public`). With no Firebase config the app runs in **demo mode**: no sign-in, goals saved in that browser only.

## Connect it to Firebase

### Option A: one command (needs a computer)

```bash
git clone <this repo> && cd nonagon
./scripts/setup.sh            # or ./scripts/setup.sh my-project-id
```

The script signs you in, creates the Firebase project, creates the Firestore database, registers the web app, writes `public/js/config.js`, turns on Google and email sign-in, deploys the security rules, and publishes the site to `https://<project-id>.web.app`. Commit the files it changes.

### Option B: from the Firebase console (works on a phone)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Create a project**. Analytics can stay off.
2. **Build → Firestore Database → Create database.** Pick a location, start in production mode.
3. **Firestore → Rules:** replace everything with the contents of [`firestore.rules`](firestore.rules) and **Publish**.
4. **Build → Authentication → Get started → Sign-in method:** enable **Email/Password** and **Google**.
5. **Project settings (gear) → Your apps → Web (</>)**: register an app, then copy the `firebaseConfig` values into [`public/js/config.js`](public/js/config.js) and commit.
6. Host it on GitHub Pages: in this repo go to **Settings → Pages → Source** and pick **GitHub Actions**. The included workflow publishes `public/` on every push, to `https://<your-username>.github.io/<repo>/`.
7. Back in Firebase, **Authentication → Settings → Authorized domains → Add domain**: `<your-username>.github.io`.

### Turn on Facebook sign-in

Facebook requires its own developer app; Firebase can't create it for you.

1. At [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create app**, choose **Authenticate and request data from users with Facebook Login**.
2. In the app's **Settings → Basic**, copy the **App ID** and **App secret**.
3. In Firebase: **Authentication → Sign-in method → Add new provider → Facebook**, paste both, and copy the **OAuth redirect URI** it shows.
4. Back in Facebook: **Facebook Login → Settings → Valid OAuth Redirect URIs**, paste that URI, save.
5. Switch the Facebook app to **Live** mode when you're ready for the public (it needs a privacy policy URL).

Until then the Facebook button shows a clear "this sign-in method isn't turned on yet" message.

## How it's built

| File | What it does |
| --- | --- |
| `public/js/layout.js` | Grid geometry. Every square owns a region; children sit in the 8 surrounding thirds, recursively. Builds the visible tiles for both views and rolls up progress. |
| `public/js/stage.js` | Renders tiles as positioned DOM elements with level-of-detail, and handles tap, long-press, drag, pinch and wheel. |
| `public/js/camera.js` | Smooth zoom-and-pan path (van Wijk & Nuij), so jumps between distant squares pull back, glide and dive in. |
| `public/js/editor.js` | Board screen: navigation, editing, undo/redo, saving, share, export. |
| `public/js/store.js` | Firestore storage, or browser storage in demo mode. |
| `public/js/auth.js` | Google, Facebook and email sign-in, verification and reset. |
| `firestore.rules` | Owners read and write their boards; anyone can read a board with sharing on; email accounts must verify first. |

Each goal is one Firestore document (`boards/{id}`) holding all its squares, which comfortably fits thousands of steps.

## Keyboard

`Esc` up a level · `O` see all · `V` switch view · `E` edit the open square · `Ctrl/⌘ Z` undo · `Ctrl/⌘ Shift Z` redo
