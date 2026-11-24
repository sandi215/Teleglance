# TeleGlance — Telegram at a glance (Even Realities "Heads Up")

**Track 01 · Messaging & News.** Check Telegram without pulling out your
phone: unread chats at a glance on Even G2 smart glasses, AI digests of
channels, and voice replies with an AI draft you approve with one tap.

Built for the Even Realities "Heads Up" hackathon (build week 23–29 Nov
2026, DoraHacks). Solo build by Sandi Supriatna + AI agent Yua Mikami.

## What it does

- **Home (glance):** up to 3 conversations with unread counts + one-line preview.
- **Digest view:** AI summary of a channel/group's recent messages, max 3 bullets.
- **Detail view:** latest messages in a chat, newest first.
- **Reply flow:** tap Reply → speak → transcript → AI draft → Send / Rewrite /
  Cancel → Bot API `sendMessage` → `Sent ✓`.

## Run

```bash
# glasses app (Vite dev server, port 5173)
npm install
npm run dev

# backend (Express, port 3000) — separate terminal
npm --prefix server install
npm run server
```

Then either:

- **Simulator:** `xvfb-run -a ./node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator http://localhost:5173 --automation-port 9898`
  (or `npm run simulate` on a machine with a display)
- **Real glasses:** `npx evenhub qr --url http://<your-ip>:5173` and scan with
  the Even Hub companion app.

Headless journey test (needs the dev server + simulator running):

```bash
python3 scripts/sim-test.py
```

## Pack for distribution

```bash
npm run pack
```

Produces `teleglance-0.1.0.ehpk` (Even Hub package, `EHPK` magic) from
`app.json` + `dist/`. The pack step pins `--sdk-ver 0.0.10` so the
stamped `min_app_version` (2.2.5) matches the SDK the app was built
against; without it the CLI uses the latest published SDK's floor.
The package includes `public/icon.png` (24×24 greyscale glasses mark),
copied into `dist/` by the build.

## Backend config

Copy `.env.example` to `server/.env`:

- `TELEGRAM_BOT_TOKEN` — bot token from @BotFather (backend only, **never**
  in the app bundle, never committed). If unset, the backend calls the Bot
  API through the sanctioned `custom.telegram` connector helper instead
  (`TELEGRAM_HELPER` overrides its path) — the token never leaves the
  connector either way.
- `XINGCHI_API_KEY` — optional LLM key for AI digests/drafts. If unset, the
  backend uses an extractive fallback (first-lines / keyword summary).
- `DEMO_MODE=1` — scripted demo data + scripted transcripts (the headless
  simulator has no live mic).

Endpoints: `GET /health`, `GET /api/inbox`, `GET /api/messages?chat=<id>`,
`GET /api/digest?chat=<id>`, `POST /api/stt` (PCM → transcript),
`POST /api/draft` (transcript → reply draft, variants via Rewrite),
`POST /api/send` (Bot API `sendMessage`; demo chats resolve to
`DEMO_TARGET_CHAT` when set, otherwise an honest demo stub).

## QA (Day 5)

Headless journey test (`python3 scripts/sim-test.py`, simulator
automation port 9898): boot 4839 lit px, no console errors at boot,
12-step tap journey home → detail → reply → digest → home → detail →
reply → record → menu → sent → home, every step changes the screen
(>100 px diff), double-tap on root fires `DOUBLE_CLICK_EVENT`
(eventType 3, verified in the console) and closes the page container.

Note on the exit dialog: `shutDownPageContainer(1)` raises a **system**
foreground dialog — the user decides whether to exit — so it does not
render inside the app page container and is not visible in the glasses
screenshot. The verifiable evidence is the console eventType 3 + the
container closing (0 lit px). The 30 s inbox refresh timer is cleared
on exit, so no `container 1 not found` errors appear after shutdown.

Production builds are clean: `npm run build` (`tsc --noEmit` + Vite)
and `npm --prefix server run build` (`tsc`).

## Honest scope note — Bot API limits

A Telegram bot can only read messages sent to it (DMs) and groups/channels
where it is a member/admin. It **cannot** read a user's personal chats (that
needs MTProto user login — out of scope). TeleGlance is therefore a
**bot-inbox + channel-digest** app: you talk to the bot and add it to the
groups/channels you follow. The demo uses a demo bot + demo group.

## Demo mode

The headless simulator has no live mic. In demo mode, tapping Reply inserts
a scripted transcript. The real path (mic → backend → Whisper-compatible
STT endpoint via env var) is implemented from the `asr` template; see
`server/index.ts`.

## Demo video

`demo/teleglance-demo.mp4` (2:07, captions only, no speaking) — recorded
in the free simulator: home glance, channel digest, voice reply with AI
draft, and the reply landing live in the real Telegram demo group
("TeleGlance Demo"). The send in the video is real: the backend posted
the draft to the group via the Bot API (`DEMO_TARGET_CHAT`).

## Money safety

Read-only data + bot sends only. No user funds, no trading, no financial
advice, no API keys in the app. `app.json` network whitelist covers the
backend URL only.

## What existed before 23 Nov 2026

- The Even Hub `minimal` template (MIT) from
  `even-realities/evenhub-templates` — scaffolded Day 1, then adapted.
- `@evenrealities/even_hub_sdk`, `@evenrealities/evenhub-cli`,
  `@evenrealities/evenhub-simulator` (npm).
- Vite, TypeScript, Express, `tsx` (npm).
- All TeleGlance app code (`src/`, `server/`) was written during the
  hackathon, 23–29 Nov 2026.

## License

MIT — see `LICENSE`.
