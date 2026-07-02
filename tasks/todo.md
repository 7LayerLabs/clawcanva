# Project: ClawCanvas v2 — make CLAW actually understand your agents

## Problem Statement
ClawCanvas works but CLAW is shallow. It can't route by what an agent is *doing*
("the github doing the scraper, tell it to commit"), it can't answer questions
about your agents, and its replies are terse. Root cause: the orchestrator brain
never sees any terminal output — only each agent's name + folder — and it runs on
haiku with a hard "max 15 words" cap. Also: the UI should read cleaner, closer to
the cnvs.dev reference.

## Plan

### Phase 1 — Make CLAW see (the real fix)
- [ ] Frontend: add `readTail(pane)` that pulls the last ~40 non-blank lines from
      each terminal's xterm buffer.
- [ ] Frontend: include a trimmed `context` (recent output) per agent in the
      `/api/orchestrate` body, plus the current voice-target name.
- [ ] Server: inject each agent's recent output into the brain prompt so it can
      route by activity and answer about state.
- [ ] Server: bump default model haiku -> sonnet (env-overridable) for real
      reasoning over terminal output.

### Phase 2 — Better, deeper responses
- [ ] Prompt rewrite: two reply styles. Commands get a short spoken confirm;
      questions get a real answer that names the agent and cites what it sees.
- [ ] Add a `detail` field: spoken reply stays a concise digest, full answer is
      written to the CLAW log so depth lives on screen, not just in audio.
- [ ] Activity-based routing: brain resolves "the one doing X" -> a callsign by
      reading buffers, not just fuzzy-matching names/folders.

### Phase 3 — Cleaner look (match the reference)
- [ ] Pane header: add a muted "· Claude Code" subtitle under the callsign,
      calmer borders/shadows, softer focus glow.
- [ ] Restyle the CLAW panel to read like the reference chat (roomier lines,
      clearer you/CLAW distinction, bigger input).
- [ ] Keep changes CSS-only where possible; no behavior risk.

## Five ideas (for Derek to pick from — not yet scheduled)
1. Live activity strip — each agent's callsign + auto one-line "what it's doing
   now", color-coded idle/working/blocked/error. Glanceable command board.
2. "Waiting for you" alerts — detect a blocked permission prompt / question in a
   pane, flash it, and have CLAW say "juno needs you." Never miss a stuck agent.
3. Spoken standup — "everyone, status" -> CLAW reads all buffers and gives ONE
   synthesized briefing instead of you reading four terminals.
4. Browser preview panes — iframe pane on a localhost port so a site renders live
   next to the agent building it (Bobola's / SoulClaw / MenuSparks).
5. Named boards — save/load whole canvas layouts per theme ("DBClaw board",
   "Restaurant board") so morning boot-up is one click.

## Progress Notes
- Shipped Phases 1-7 + "needs you" alerts in one pass.

## Review
### Changes Made
- **server.js**: brain now default `sonnet` (env `CLAW_MODEL` to switch haiku/opus),
  60s timeout; prompt rewritten to include each agent's on-screen output + recent
  conversation history; two reply modes (command confirm vs question answer) with
  optional `detail` and `artifact` fields.
- **public/app.js**: `readTail()` reads each terminal's xterm buffer; orchestrate payload
  now sends per-agent `context` + `target` + `history`; `detail`/`artifact` rendering;
  "needs you" prompt detection (rolling tail + regex) flashes pane and speaks name;
  hands-free `conversationMode` with echo guard; `localCommand()` shortcuts (menu, status,
  conversation); `renderArtifact()` (status board / markdown / mermaid); CLAW face moods.
- **public/index.html**: artifact panel, CLAW face SVG, CONV + PANEL buttons, marked +
  mermaid CDN libs.
- **public/style.css**: calmer pane chrome, pane subtitle, needs-you pulse, roomier CLAW
  panel, artifact panel + fleet board, animated face.
- **README.md**: documented new capabilities + `CLAW_MODEL` switch.

### Verified
- Syntax-checked server.js + app.js. Server boots, serves 200, layout API OK.
- Real Sonnet brain call: routed a QUESTION by activity ("the one working on the scraper")
  to JUNO from its terminal output, returned a short spoken `say` + rich `detail`. Works.

### Notes
- Voice + Web Speech still Edge-only. Sharing/multiplayer remains a documented future
  project (see the approved plan), not built.

---

## Archive — v1 (shipped)
Infinite canvas, spawn Claude Code panes with callsigns, voice routing
(tell/broadcast/close), Web Speech STT + speechSynthesis TTS, OpenClaw fleet
relay, layout persistence. Port 18790. node-pty on Node 24, conpty prebuilt.
