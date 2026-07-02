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
  - `vega, commit what you have` → routed to VEGA
  - `everyone, stop what you're doing` → broadcast to all agents
  - `close atlas` / `spawn agent` → canvas commands
  - anything else → goes to the current voice target (the ◉ pane; focusing a terminal sets it)
  - It talks back with confirmations using Windows built-in speech — no API costs.
- **Persistence** — layout, notes, and camera autosave to `data/layout.json`.
  Terminal panes come back with a LAUNCH button (use the "continue last session"
  preset to resume a Claude conversation).

## Stack

Node + express + ws + node-pty (real ConPTY terminals) on :18790, xterm.js frontend,
Web Speech API for voice in/out. No accounts, no subscriptions, no $99.
