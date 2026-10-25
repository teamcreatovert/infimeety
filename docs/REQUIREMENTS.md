# Infimeety — Requirements

Every request from the planning conversation, tracked in one place.

✅ built and verified · 🔶 built, not yet verified on real hardware/accounts · ⏳ later phase

## Platform & hosting
- ✅ PC app first: Tauri v2 desktop shell compiles and runs (Windows)
- ⏳ Web version on Cloudflare Pages: the React UI already runs in a browser; needs a web build for media sharing
- 🔶 Backend fully on Cloudflare free tier (Workers + Durable Objects + D1 + KV): runs locally under wrangler; not deployed yet
- ✅ Unlimited meetings: no timers or caps anywhere in the code

## Accounts
- 🔶 Sign in with Google: flow built; needs your OAuth client (docs/SETUP.md §3)
- 🔶 Sign in with Discord: flow built; needs your Discord app (docs/SETUP.md §4)
- ✅ Onboarding: display name, @username (live availability check), email from provider, profile photo
- 🔶 Photo defaults to the Google/Discord picture; upload any image or GIF (verified up to the upload UI)
- ✅ Stays signed in across restarts (session token in the WebView profile, untouched by updates)

## Structure (Discord/Slack-like)
- ✅ Create a channel; invite friends with an 8-character code
- ✅ Unlimited chat rooms and voice rooms per channel (admins add them inline)
- ✅ Every voice room has its own side chat

## Voice
- ✅ P2P mesh voice: verified two peers connected, audio flowing, speaking detection
- ✅ Light voice for bigger calls: mono 40 kbps + DTX (verified ~0 kbps while silent); stereo only for screen-share sound
- ✅ Mute mic, deafen
- ✅ Per-person volume 0–200% (Web Audio gain per person)
- ✅ Mute someone just for me
- 🔶 Admin server-mute a person (server-enforced; UI built)
- 🔶 Admin mute an entire voice room (admins can still talk)
- ✅ Camera on/off: verified video flowing P2P
- ⏳ Cloudflare Realtime SFU for 10+ people with heavy screen sharing

## Screen sharing
- ✅ Entire screen or a specific app window (system picker): verified in the desktop app (~1080p, 0% loss)
- ✅ Share system audio with the screen: native WASAPI capture, stereo 192 kbps Opus, verified in the desktop app
- ✅ No echo: friends' voices played by Infimeety are excluded from the shared sound (capture excludes the WebView2 browser process tree; verified with a beep test, 0.000 leak)
- ⏳ Specific browser tab: web version only
- ✅ Quality presets (720p30 → 1440p60) and Movies/Text optimization
- ⏳ Per-app-only audio capture (needs native Windows process loopback)

## Watch-together (movie mode)
- ✅ A shared screen fills the stage, letterboxed, with stream volume control
- ✅ Opens automatically when a friend shares (including when you join late)
- ✅ Loom-style person bubbles: drag anywhere, magnetic edges, minimize (double-click)
- ✅ Side chat beside the movie
- ✅ Full screen and auto-hiding controls
- Note: DRM sites (Netflix, etc.) can show black; the sharer turns off browser hardware acceleration

## Chat
- ✅ Emoji picker (search, categories, recents, hides emoji Windows can't draw) and reactions (one per person, like iMessage)
- ✅ Replies, edits, deletes, markdown, links, typing indicator, unread badges
- ✅ Send images, GIFs and videos from disk, by paste or by drag-and-drop (verified drag-drop in the desktop app)
- ✅ Media stays on the sender's PC; only text + metadata reach the server
- ✅ Viewers stream media P2P from the sender (verified: 1.9 MB image in about 1 s); offline sender → "available when online"
- 🔶 Sender deletes the local file → "Removed" for everyone (watcher checks every 10 s)

## Design
- ✅ Apple-style glassmorphism, flush layout with hairline dividers
- ✅ SF Pro when installed, bundled Inter fallback
- ✅ Spring motion throughout (Motion), shared-layout highlights
- ✅ Synthesized sound design (join/leave/mute/deafen/message/share)
- ✅ Windows 11–style title bar with minimize / maximize / close on a frameless glass window (changed from macOS traffic lights at your request)
- ✅ Light/dark/auto theme, 7 accent colors, 5 wallpapers, reduce transparency

## Updates
- 🔶 "New version available" card → Update & restart → stays signed in (needs your signing key + GitHub repo)
- 🔶 Release pipeline: `.github/workflows/release.yml` (tag `v*` → signed installer + latest.json)

## Later
- ⏳ Web version on Cloudflare Pages
- ⏳ Cloudflare Realtime SFU
- ⏳ Games
