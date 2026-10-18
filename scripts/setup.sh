#!/usr/bin/env bash
# One-time setup: creates a Firebase project for Nonagon, turns on Firestore,
# Google and email sign-in, writes the web config, and deploys.
#
#   ./scripts/setup.sh [project-id]
#
# Needs Node.js 18+. Run it from the repo root on a computer with a browser.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${1:-nonagon-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)}"
REGION="${REGION:-nam5}"

if ! command -v firebase >/dev/null 2>&1; then
  echo "Installing the Firebase CLI..."
  npm install -g firebase-tools
fi

echo "Signing in to Firebase (a browser window will open)..."
firebase login

read -r -p "Email to show on the Google sign-in screen (support email): " SUPPORT_EMAIL
[ -n "$SUPPORT_EMAIL" ] || { echo "A support email is required for Google sign-in."; exit 1; }

echo "Creating project $PROJECT_ID..."
firebase projects:create "$PROJECT_ID" --display-name "Nonagon"
printf '{\n  "projects": { "default": "%s" }\n}\n' "$PROJECT_ID" > .firebaserc

echo "Creating the Firestore database in $REGION..."
firebase firestore:databases:create "(default)" --location="$REGION" --project "$PROJECT_ID"

echo "Registering the web app..."
APP_JSON="$(firebase apps:create web "Nonagon Web" --project "$PROJECT_ID" --json)"
APP_ID="$(node -e 'const j=JSON.parse(process.argv[1]);console.log((j.result||j).appId)' "$APP_JSON")"

echo "Writing public/js/config.js..."
CFG_JSON="$(firebase apps:sdkconfig web "$APP_ID" --project "$PROJECT_ID" --json)"
node - "$CFG_JSON" <<'NODE'
const fs = require('fs');
const raw = JSON.parse(process.argv[2]);
const find = (o) => (o && typeof o === 'object' ? (o.apiKey ? o : Object.values(o).map(find).find(Boolean)) : null);
const c = find(raw);
if (!c) { console.error('Could not read the web config from the Firebase CLI output.'); process.exit(1); }
const keys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
const body = keys.map((k) => `  ${k}: ${JSON.stringify(c[k] || '')},`).join('\n');
const file = 'public/js/config.js';
const src = fs.readFileSync(file, 'utf8').replace(/export const firebaseConfig = \{[\s\S]*?\};/, `export const firebaseConfig = {\n${body}\n};`);
fs.writeFileSync(file, src);
NODE

echo "Setting the Google sign-in support email..."
node -e '
const fs=require("fs");const f="firebase.json";const j=JSON.parse(fs.readFileSync(f,"utf8"));
j.auth.providers.googleSignIn.supportEmail=process.argv[1];fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$SUPPORT_EMAIL"

echo "Deploying rules, sign-in settings and the site..."
firebase deploy --project "$PROJECT_ID" --only firestore:rules,auth,hosting

cat <<DONE

Done. Your app is live at:
  https://$PROJECT_ID.web.app

Google and email sign-in are on. To add Facebook sign-in, follow
"Turn on Facebook sign-in" in README.md.

Commit public/js/config.js, .firebaserc and firebase.json so the setup is saved.
DONE
