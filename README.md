# ClawCanvas (beta)

Free Windows version of [cnvs.dev](https://cnvs.dev) — an infinite canvas where you
spawn Claude Code agents as terminal panes and command them with your voice.

## Run it

Double-click `start-clawcanvas.cmd`, or:

```
cd C:\Users\Derek\clawcanvas
npm start
```

Then open **http://localhost:18790** (use Edge or Chrome — voice needs the Web Speech API).

## How it works

- **+ AGENT** — spawns a Claude Code terminal in any project folder. Each agent gets a
  callsign (ROOK, JUNO, VEGA, …) shown in its title bar.
- **+ SHELL** — plain PowerShell pane.
- **+ NOTE** — sticky scratch pad.
- **Canvas** — drag the background to pan, scroll to zoom (ctrl+scroll over a pane),
  drag headers to move panes, bottom-right grip to resize, double-click a title to rename.
- **Voice** — hold **F2** (or the TALK button), speak, release:
  - `tell juno to run the tests` → routed to JUNO
  - `the one working on the scraper, commit what you have` → **routed by what the agent is
    doing** (CLAW reads each pane's output to pick the right one)
  - `what's everyone doing?` / `what's atlas stuck on?` → CLAW **reads the terminals and
    answers**, out loud plus full detail in the artifact panel
  - `everyone, stop what you're doing` → broadcast to all agents
  - `close atlas` / `spawn agent` → canvas commands
  - `show me the menu` / `what can you do` → capability list in the panel
  - `show me a status board` → live fleet board (who's working / blocked / idle)
  - It talks back with Windows built-in speech — no API costs.
- **CONV (conversation mode)** — click CONV (or say “conversation mode”) to go hands-free:
  the mic stays open, you just talk, CLAW answers and remembers the thread. Say “stop
  listening” to end. Uses the same free Web Speech (no paid realtime API).
- **Artifact panel** — a right-side panel (toggle with **PANEL**) where CLAW *shows*
  things: a live fleet status board, rich answers, and mermaid diagrams.
- **“Needs you” alerts** — when an agent stalls on a permission prompt, its pane flashes
  amber and CLAW says its name, so a blocked agent can’t hide off-screen.
- **CLAW brain model** — defaults to **Sonnet** (smart enough to read terminal output and
  route/answer). Switch without touching code: set the `CLAW_MODEL` env var to `haiku`
  (fastest) or `opus` (deepest) before `npm start`.
- **Persistence** — layout, notes, and camera autosave to `data/layout.json`.
  Terminal panes come back with a LAUNCH button (use the "continue last session"
  preset to resume a Claude conversation).

## Stack

Node + express + ws + node-pty (real ConPTY terminals) on :18790, xterm.js frontend,
Web Speech API for voice in/out. No accounts, no subscriptions, no $99.
