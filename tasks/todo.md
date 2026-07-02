# Project: ClawCanvas

## Problem Statement
Derek wants cnvs.dev ($99, macOS-only) but free and on Windows: an infinite canvas
where you spawn coding agents (Claude Code) as terminal panes, direct them with
voice, and keep notes — all projects on one board.

## Plan
- [x] Scaffold project + install express/ws/node-pty (node-pty prebuilds work on Node 24)
- [x] server.js — static hosting, layout persistence API, WebSocket → node-pty bridge
- [x] public/index.html — canvas viewport, topbar, spawn modal, voice HUD
- [x] public/style.css — dark command-center aesthetic (Chakra Petch + IBM Plex Mono, ember accent)
- [x] public/app.js — infinite pan/zoom canvas, draggable/resizable panes, xterm.js
      terminals over WS, sticky notes, voice orchestrator, autosave layout
- [x] Voice orchestrator v2 (after Derek's video screenshot): agents get callsigns,
      "tell juno to …" routing, broadcast, close-by-name, spoken confirmations
- [x] Smoke test: HTTP 200, layout API OK, WS→PTY spawn/echo/exit OK

## Progress Notes
- node-pty OK on Node v24.15.0, conpty prebuilt binary — no build tools needed.
- Port 18790 (gateway uses 18789).
- CNVS's talk-back layer is OpenAI GPT Realtime (visible in Derek's screenshot);
  ClawCanvas uses free Web Speech API (STT) + speechSynthesis (TTS) instead.

## Review
### Changes Made
- New project `C:\Users\Derek\clawcanvas`: server.js, public/{index.html,style.css,app.js},
  start-clawcanvas.cmd, README.md, test-ws.js.
- Deps: express, ws, node-pty. `npm start` runs it on http://localhost:18790.

### Notes
- Voice needs Edge/Chrome. Commands run inside `powershell -Command` so npm shims
  like `claude` resolve.
- Sessions don't survive restarts (they're real PTYs); restored panes show a LAUNCH
  button — use the `claude --continue` preset to resume conversations.
- Possible v2: pipe voice through GPT Realtime or Claude for a smarter orchestrator,
  browser panes, minimap.
