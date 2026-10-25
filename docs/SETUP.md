# Infimeety — Setup Guide

Everything here runs on free tiers. You need a Cloudflare account (free), a Google Cloud
project (free) and a Discord developer app (free). A GitHub repo is needed for auto-updates.

---

## 1. Run it locally

Prerequisites: Node 20+, Rust (stable), Windows 10/11 (WebView2 is built in).

```bash
# Terminal 1 — backend (Workers + Durable Objects + D1, all emulated locally)
cd server
npm install
cp .dev.vars.example .dev.vars        # DEV_LOGIN=true enables the "Local testing" sign-in
npm run db:migrate:local
npm run dev                           # http://localhost:8787

# Terminal 2 — desktop app
cd app
npm install
npm run desktop                       # opens the Infimeety window (Vite + Tauri)
```

`DEV_LOGIN=true` adds a "Local testing" box on the sign-in screen so you can try everything
before OAuth is configured. **Never set it in production.**

> Tip: the UI also runs in a normal browser at http://localhost:1420 (useful for styling),
> but local media sharing, drag-and-drop and auto-update only work in the desktop app.

---

## 2. Deploy the backend to Cloudflare (free)

```bash
cd server
npx wrangler login
npx wrangler d1 create infimeety              # copy the database_id it prints
npx wrangler kv namespace create AVATARS      # copy the id it prints
```

Edit `server/wrangler.jsonc`:

- `d1_databases[0].database_id` → the D1 id
- `kv_namespaces[0].id` → the KV id
- `vars.PUBLIC_URL` → your Worker URL, e.g. `https://infimeety-api.<your-subdomain>.workers.dev`
  (deploy once first if you don't know it yet — wrangler prints the URL)

Then:

```bash
npm run db:migrate:remote
npm run deploy
```

Free-plan notes: Durable Objects are free when they use the SQLite backend (already configured
via `new_sqlite_classes`). Idle channels hibernate and cost nothing. Messages are tiny text rows
in D1 (5 GB free). Custom avatars live in Workers KV (1 GB free).

---

## 3. Google sign-in

1. Go to <https://console.cloud.google.com/> → create a project (e.g. "Infimeety").
2. **APIs & Services → OAuth consent screen** → *External* → fill in app name, support email,
   and add scopes `openid`, `email`, `profile`. Add yourself as a test user, or click
   **Publish app** so anyone can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `https://<your-worker-url>/auth/google/callback`
     - `http://localhost:8787/auth/google/callback` (local testing)
4. Copy the client ID and secret:

```bash
cd server
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

For local testing, put the same values in `server/.dev.vars`.

## 4. Discord sign-in

1. Go to <https://discord.com/developers/applications> → **New Application** ("Infimeety").
2. **OAuth2** → add redirects:
   - `https://<your-worker-url>/auth/discord/callback`
   - `http://localhost:8787/auth/discord/callback`
3. Copy **Client ID** and **Client Secret** (click *Reset Secret* to reveal one):

```bash
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
```

If someone signs in with Google and Discord using the same verified email, both logins open
the same account.

## 5. Point the app at your backend

Create `app/.env.production`:

```
VITE_API_URL=https://<your-worker-url>
```

## 6. (Optional) TURN relay for strict networks

Most friends connect directly. For the few behind strict corporate/mobile NATs, add Cloudflare's
TURN relay (1,000 GB/month free): Cloudflare dashboard → **Realtime → TURN Server → Create**,
then:

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

---

## 7. One-click auto-updates

Installed apps check for updates on launch and every 30 minutes. When one is found, a glass
card offers **Update & restart**: it downloads, installs silently, and reopens the app. The
session lives in the WebView profile, which updates never touch, so users stay signed in.

### One-time setup

1. Generate the update signing key (keep it safe — **if you lose it, existing installs can
   never update again**; back it up somewhere private):

   ```bash
   cd app
   npx tauri signer generate -w ~/.tauri/infimeety.key
   ```

2. Paste the **public** key it prints into `app/src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey`.
3. Push this project to GitHub, then set `plugins.updater.endpoints` to
   `https://github.com/<you>/<repo>/releases/latest/download/latest.json`.
4. In the GitHub repo → **Settings → Secrets and variables → Actions**:
   - Secret `TAURI_SIGNING_PRIVATE_KEY` → contents of `~/.tauri/infimeety.key`
   - Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` → the password you chose
   - Variable `VITE_API_URL` → your Worker URL

### Shipping an update

1. Bump the version in `app/package.json`, `app/src-tauri/tauri.conf.json` and
   `app/src-tauri/Cargo.toml` (e.g. `0.2.0`).
2. Commit, then tag and push:

   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```

3. The **Release** workflow builds the signed Windows installer plus `latest.json` and
   publishes the GitHub release. Everyone running Infimeety sees the update prompt.

Building an installer locally (`npm run desktop:build`) also needs the key:
set `TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`) in your shell first.

---

## 8. Good to know

- **Voice is peer-to-peer (mesh).** Voices are mono Opus at 40 kbps with DTX, so someone who
  isn't talking sends almost nothing. That makes voice-only calls comfortable up to ~25–30
  people; with cameras on, ~4–6; with a screen share, ~8 viewers (the bitrate is split across
  them automatically). Screen-share sound is stereo at 192 kbps. For bigger rooms the plan is to
  add Cloudflare Realtime SFU (1 TB/month free) behind the same voice engine.
- **Media in chat never touches the server.** Viewers stream it from the sender's PC while
  the sender is online. Delete the file and it shows as "Removed" for everyone.
- **Watching Netflix together.** DRM-protected sites (Netflix, Disney+, Prime) can appear black
  when screen-shared. The sharer should turn off *Use graphics acceleration when available* in
  their browser settings, restart the browser, then share the entire screen with sound on.
- **Shortcuts:** `Ctrl+Shift+M` mute, `Ctrl+Shift+D` deafen. Double-click a person bubble in
  watch mode to minimize it; drag it anywhere.
