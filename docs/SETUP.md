# Infimeety — Setup Guide

Everything here runs on free tiers. You need a Cloudflare account (free), a Google Cloud
project (free) and a Discord developer app (free). A GitHub repo is needed for auto-updates.

---

## 1. Run it locally

Prerequisites: Node 20+, Rust (stable), and Windows 10/11 (WebView2 is built in) or macOS 11+
(with Xcode Command Line Tools: `xcode-select --install`).

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

> Tip: the whole app also runs in a normal browser at http://localhost:1420 (that's the web app).
> Add `?meet=CODE` to join a meeting as a guest. Auto-update, the tray and the voice overlay are
> desktop-only; media sharing works in both (the browser keeps shared files in its own storage).

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
npm run deploy:all        # database migrations, then the Worker (hosts the realtime Durable Object) + Pages
```

`deploy:all` applies any new database migrations first (wrangler may ask you to confirm with
`y`). See [SECURITY.md](SECURITY.md) for what's protected and how.

The app talks to **https://infimeety.pages.dev/api** (Pages project `infimeety`, config in
`server/pages/wrangler.jsonc`). The Pages site also serves:

| Path | What |
| --- | --- |
| `/` | Landing page (`server/pages/public/index.html`) |
| `/download` | Windows and Mac downloads (`server/pages/public/download.html`). It links the latest GitHub release, and shows "Mac coming with the next update" until a release has a Mac build. |
| `/web/` | The web app, built by `npm run pages:build` (part of `deploy:all`) |
| `/xxxx-xxxx-xxx`, `/invite/CODE` | Meeting and invite link pages |

Sign-in in the web app goes to Google/Discord and back in the same tab, through the same
callback URLs as the desktop app, so the OAuth setup below covers both.
The Worker at `infimeety-api.<subdomain>.workers.dev` hosts the Durable Object both share.

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
     - `https://infimeety.pages.dev/api/auth/google/callback`
     - `http://localhost:8787/auth/google/callback` (local testing)
4. Store the client ID and secret in the Pages project (each command asks for the value):

```bash
cd server/pages
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name infimeety
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name infimeety
```

For local testing, put the same values in `server/.dev.vars`.

## 4. Discord sign-in

1. Go to <https://discord.com/developers/applications> → **New Application** ("Infimeety").
2. **OAuth2** → add redirects:
   - `https://infimeety.pages.dev/api/auth/discord/callback`
   - `http://localhost:8787/auth/discord/callback`
3. Store **Client ID** and **Client Secret** (click *Reset Secret* to reveal one):

```bash
cd server/pages
npx wrangler pages secret put DISCORD_CLIENT_ID --project-name infimeety
npx wrangler pages secret put DISCORD_CLIENT_SECRET --project-name infimeety
```

If someone signs in with Google and Discord using the same verified email, both logins open
the same account.

## 5. Point the app at your backend

`app/.env.production` holds the Worker URL used by installer builds
(currently `https://infimeety-api.leveling-life-sync.workers.dev`).
`npm run dev` keeps using the local Worker.

## 6. (Optional) TURN relay for strict networks

Most friends connect directly. For the few behind strict corporate/mobile NATs, calls go
through a TURN relay. Any TURN server with a fixed login works; the default is
[ExpressTURN](https://www.expressturn.com/)'s free plan (1,000 GB/month, email sign-up, no card).
Sign up, open the dashboard, then paste its **TURN Server**, **Username** and **Password**:

```bash
cd server/pages
npx wrangler pages secret put TURN_SERVER --project-name infimeety
npx wrangler pages secret put TURN_USERNAME --project-name infimeety
npx wrangler pages secret put TURN_PASSWORD --project-name infimeety
npm --prefix .. run pages:deploy
```

Pages secrets only apply from the next deploy, hence the last line. Check it at
`https://infimeety.pages.dev/api/ice/status`: `"turn":"ok"` means the relay accepted the login.
If you press **Refresh Credentials** in ExpressTURN, put the new username and password again.

Cloudflare Realtime TURN also works (it needs a card on file): set `TURN_KEY_ID` and
`TURN_KEY_API_TOKEN` instead.

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
3. The updater already checks
   `https://github.com/teamcreatovert/infimeety/releases/latest/download/latest.json`.
   Keep the repo's releases public, or installed apps can't download updates.
4. In the GitHub repo → **Settings → Secrets and variables → Actions**:
   - Secret `TAURI_SIGNING_PRIVATE_KEY` → contents of `~/.tauri/infimeety.key`
   - Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` → the password you chose (skip it if the key
     has no password)

   (The API address for release builds comes from `app/.env.production`.)

### Shipping an update

1. Bump the version in `app/package.json`, `app/src-tauri/tauri.conf.json` and
   `app/src-tauri/Cargo.toml` (e.g. `0.2.0`).
2. Commit, then tag and push:

   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```

   Or use **Actions → Release → Run workflow**, which also takes release notes and a dry-run
   switch.
3. The **Release** workflow builds the Windows installer and the Mac app (one universal build
   for Apple Silicon and Intel) side by side. It code-signs the Windows installer once SignPath is
   set up ([CODE-SIGNING.md](CODE-SIGNING.md)) and signs both for the updater. Then it publishes
   one GitHub release with `Infimeety-Setup.exe`, `Infimeety.dmg` and `latest.json`. Everyone
   running Infimeety, on either system, sees the update prompt. If the Mac build fails, the
   release still goes out for Windows (with a warning), and Macs keep their current version.
4. Deploy the website too (`cd server && npm run deploy:all`), so the web app matches the new
   version.

Building an installer locally (`npm run desktop:build`) also needs the key:
set `TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`) in your shell first. Local builds are never
code-signed, so ship releases from the workflow.

---

## 8. Mac builds and Apple signing (optional)

The Release workflow builds the Mac app with no extra setup. Without an Apple Developer account
it's **ad-hoc signed**: it runs fine, but the first time someone opens it macOS says it can't
check the app. They open **System Settings → Privacy & Security** and click **Open Anyway**
(the download page explains this). Updates install silently after that.

To make it open without that step, sign and notarize it with an Apple Developer ID
($99/year at <https://developer.apple.com/programs/>):

1. In Xcode or the developer site, create a **Developer ID Application** certificate and export
   it from Keychain Access as a `.p12` with a password.
2. Create an app-specific password for your Apple ID at <https://account.apple.com>.
3. Add these GitHub secrets (Settings → Secrets and variables → Actions):
   - `APPLE_CERTIFICATE`: the `.p12` as base64 (`base64 -i cert.p12 | pbcopy`)
   - `APPLE_CERTIFICATE_PASSWORD`: the `.p12` password
   - `APPLE_SIGNING_IDENTITY`: e.g. `Developer ID Application: Your Name (TEAMID)`
   - `APPLE_ID`, `APPLE_PASSWORD` (the app-specific password) and `APPLE_TEAM_ID` for notarization

The next release is then signed and notarized automatically.

Mac specifics: the window keeps the standard traffic-light buttons. Closing it hides Infimeety to
the menu bar, and clicking the Dock icon brings it back. Screen sharing works, but **without the
Mac's sound** for now (the Windows app captures system sound natively).

Build one locally on a Mac: `cd app && npx tauri build --target universal-apple-darwin`
(after `rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

---

## 9. Good to know

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
