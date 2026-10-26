# Infimeety

Unlimited voice rooms, chat and watch-together for you and your friends. It's a desktop app
with an Apple-style glass interface, and it runs entirely on free tiers.

- **Channels** (like Discord servers) with any number of **chat rooms** and **voice rooms**
- **Unlimited calls**: no timers, no minute caps
- **Voice**: mute, deafen, per-person volume (0–200%), mute-for-me, noise suppression
- **Admins**: server-mute a person, mute a whole room, disconnect, promote admins
- **Screen share**: entire screen or a single app, with system sound, quality presets and
  Movie/Text optimization
- **Watch together**: a shared screen fills the stage, friends float as draggable Loom-style
  bubbles, with a side chat, full screen and auto-hiding controls
- **Chat**: emoji picker, reactions, replies, edits, markdown, typing indicators
- **Local-first media**: images, GIFs and videos stream peer-to-peer from the sender's PC. Nothing
  is uploaded. Delete the file and it's removed from the chat for everyone.
- **Sign in** with Google or Discord. Onboarding covers name, @username and photo (provider photo by
  default; any image or GIF works).
- **One-click auto-updates** that keep you signed in
- Synthesized UI sounds, spring animations, light/dark themes, accents and wallpapers

## Architecture

```
┌──────────────── Desktop app (Tauri 2 + React) ────────────────┐
│  React UI ── voice engine (WebRTC mesh + Web Audio)           │
│     │          └─ P2P media transfer (WebRTC data channels)   │
│     │                                                         │
│  Rust shell: window, updater, local media registry            │
└─────┼─────────────────────────────────────────────────────────┘
      │ HTTPS + WebSocket (text, presence, signaling only)
┌─────▼─────────────── Cloudflare (free) ───────────────────────┐
│  Worker (Hono): auth, profiles, channels, rooms, history      │
│  Durable Object per channel: realtime chat, presence,         │
│      voice state, WebRTC signaling (hibernating WebSockets)   │
│  D1: users, channels, rooms, messages   KV: custom avatars    │
└───────────────────────────────────────────────────────────────┘
```

| Folder | What's inside |
| --- | --- |
| `app/` | React + Vite frontend (shared with the future web version) and `src-tauri/` desktop shell |
| `server/` | Cloudflare Worker, Durable Object hub, D1 migrations |
| `shared/` | Types shared by app and server (the realtime protocol) |
| `docs/` | Setup guide and the requirements checklist |

## Quick start

```bash
cd server && npm install && cp .dev.vars.example .dev.vars && npm run db:migrate:local && npm run dev
cd app && npm install && npm run desktop
```

Full guide (Cloudflare deploy, Google/Discord OAuth, auto-update signing): [docs/SETUP.md](docs/SETUP.md)

## License

Infimeety is free software under the [GNU Affero General Public License v3.0](LICENSE). If you
run a modified version of it for other people, including the server, you must share your changes
under the same license.
