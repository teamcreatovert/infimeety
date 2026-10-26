# Security

What protects Infimeety, where it lives in the code, and what's still open. Last full review:
October 2026.

## Secrets

- No secret is in the code or in the git history (checked across every commit on every branch).
  `wrangler.jsonc` holds only IDs that need your Cloudflare login to use, and `app/.env.production`
  holds only the public API URL.
- OAuth client secrets and TURN logins are Cloudflare secrets (`npx wrangler secret put NAME`),
  never committed. `server/.dev.vars` (local only) is git-ignored.
- Release signing keys are GitHub Actions secrets. The workflow passes free-text inputs (release
  notes) through environment variables, never straight into a script.

## Signing in

- Google and Discord only: Infimeety stores no passwords. A sign-in hands the app a random
  256-bit session token; the database keeps only its SHA-256 hash, so a database leak exposes no
  usable sessions.
- Sessions unused for 90 days are signed out (`server/src/auth.ts`, migration `0005`).
- The test login (`/auth/dev`) only exists when `DEV_LOGIN=true`, which is set in `.dev.vars` for
  local testing and never in production.
- Meeting guests get an account that can only see that one meeting, and it's deleted with the
  meeting.

## Who can see and do what

- Every channel route checks membership (`requireRole`), and admin and owner actions check the
  role. Rooms and messages are always looked up within the channel they belong to.
- Realtime sockets join a channel only as a member. Moderation (mute, move, disconnect) follows the
  same roles, and watch-party control follows the host and co-host rules on the server.
- Invite codes only open spaces; DMs and meetings can't be joined with one.

## Input

- Every database query uses bound parameters (no SQL built from user text).
- Text has length limits; attachments, stream ids and watch-party files are checked field by
  field (`sanitizeAttachments`, `streamIds`, `cleanFile`).
- Pages the server renders escape user text. The app renders chat with React (no raw HTML), and
  links open only for `http(s)` addresses.

## Abuse limits (`server/src/limits.ts`)

- Per address: sign-in starts (60/min), sign-in polling (600/min), guest knocks (60/min), new
  channels and meetings (20/min), joins (60/min), friend requests (30/min), avatar uploads
  (10/min), public invite and meeting previews (200/min), and 3,000/min for everything together.
  They're set so a whole class or office behind one network address can still sign in and join
  at once.
- Per realtime connection: chat (a burst of 8, then 1 a second), reactions, typing, call signaling,
  file requests and watch-party messages each have their own allowance.
- These count per Cloudflare isolate, which stops a single client hammering the service. A
  large distributed attack is Cloudflare's network-level DDoS protection's job.

## Headers

- API: `nosniff`, no framing, no referrer, HSTS, and a CSP that allows nothing on JSON. The
  sign-in pages allow only their own inline script, by hash.
- Website (`server/pages/public/_headers`): the web app may run only its own scripts and connect
  only over HTTPS/WSS. Camera, microphone and screen capture are allowed for the site itself only.
- Desktop app: a strict CSP in `tauri.conf.json`, and the webview gets only the permissions it
  needs (`capabilities/`).

## Files and copies

- Shared files never touch the server; they go device to device over encrypted WebRTC.
- The desktop app saves copies only into the folder you picked in the system dialog. Nothing in
  the webview can point it anywhere else.
- A copied folder unpacks as plain files and folders only: links, `..` paths and absolute paths
  in an archive are refused, so a copy can't write outside your save folder.

## Dependencies

- `npm audit`: no known vulnerabilities in the app or the server. The server pins `undici` (used
  only by the local `wrangler dev`) to a patched version through `overrides`.

## Open items

1. **Phishing a sign-in link.** The desktop app signs in by opening the browser and then asking
   the server for the result with a secret only the app knows. Someone could start a sign-in on
   their own computer and trick a victim into finishing it ("click this link to sign in"). The
   attacker's app would then receive the victim's session. The fix is to hand the session to the
   app through the `infimeety://` link on the same computer instead. That needs an app release, so
   it's planned for the next version rather than changed underneath the current one.
2. **"Sign out everywhere"** isn't there yet. Signing out ends that device's session only.
3. **CORS** allows any origin. That's safe here because the API uses bearer tokens, not cookies,
   so another site can't act as you without your token.
4. GitHub Actions use version tags (`@v7`). Pinning them to commit SHAs would harden the release
   pipeline further.
