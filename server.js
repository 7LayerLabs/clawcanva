const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const pty = require('node-pty');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 18790;
const LAYOUT_FILE = path.join(__dirname, 'data', 'layout.json');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/layout', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')));
  } catch {
    res.json({ panes: [], camera: { x: 0, y: 0, z: 1 } });
  }
});

app.post('/api/layout', (req, res) => {
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ---- CLAW orchestrator brain: transcript -> claude -p (haiku) -> JSON actions ----

const ORCH_MODEL = process.env.CLAW_MODEL || 'haiku';

function resolveCwd(c, fallback) {
  if (!c) return fallback;
  if (fs.existsSync(c)) return c;
  const base = path.basename(c);
  for (const root of [process.env.USERPROFILE, path.join(process.env.USERPROFILE, 'Desktop')]) {
    const t = path.join(root, base);
    if (fs.existsSync(t)) return t;
  }
  return fallback;
}

app.post('/api/orchestrate', (req, res) => {
  const { transcript, agents = [], folders = [], lastCwd } = req.body;
  const prompt = `You are CLAW, the voice orchestrator for ClawCanvas — a canvas of terminal panes, each running a Claude Code agent, on Derek's Windows machine.

Canvas state:
- Agents on canvas: ${JSON.stringify(agents)}
- Known project folders: ${JSON.stringify(folders)}
- Default folder: ${JSON.stringify(lastCwd)}

Derek said (speech-to-text, may contain transcription errors): ${JSON.stringify(transcript)}

Decide what to do. Action types:
- {"type":"spawn","cwd":"C:\\\\full\\\\path","cmd":"claude"} — open a new agent. Pick a known folder if he names one (fuzzy match is fine), else the default folder. cmd is "claude", or "claude --continue" if he wants to resume a previous session.
- {"type":"send","target":"AGENTNAME"|"all","text":"..."} — give an agent an instruction. Clean up obvious transcription errors but keep his intent verbatim. Agent names sound like: rook, juno, vega, atlas, nova, orion, lyra, onyx, echo, milo.
- {"type":"close","target":"AGENTNAME"}
If he's just asking a question about the canvas or chatting, use an empty actions list and answer in "say".

CRITICAL: Do not use any tools. Do not read or write any files. Reply with RAW JSON only — no markdown fences, no commentary:
{"say":"casual spoken confirmation, max 15 words","actions":[...]}`;

  let sent = false;
  const done = (payload) => { if (!sent) { sent = true; res.json(payload); } };

  const child = spawn('cmd.exe', ['/c', 'claude', '-p', '--model', ORCH_MODEL], {
    cwd: __dirname,
    windowsHide: true,
  });
  const timer = setTimeout(() => { try { child.kill(); } catch {} }, 45000);
  let out = '';
  let errOut = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { errOut += d; });
  child.on('error', (e) => { clearTimeout(timer); done({ error: String(e) }); });
  child.on('close', () => {
    clearTimeout(timer);
    const start = out.indexOf('{');
    const end = out.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return done({ error: 'no JSON from brain', raw: (out || errOut).slice(0, 400) });
    }
    try {
      const data = JSON.parse(out.slice(start, end + 1));
      for (const a of data.actions || []) {
        if (a.type === 'spawn') a.cwd = resolveCwd(a.cwd, lastCwd);
      }
      done(data);
    } catch (e) {
      done({ error: String(e), raw: out.slice(0, 400) });
    }
  });
  child.stdin.write(prompt);
  child.stdin.end();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/term' });

wss.on('connection', (ws) => {
  let proc = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'spawn' && !proc) {
      const cwd = msg.cwd && fs.existsSync(msg.cwd) ? msg.cwd : process.env.USERPROFILE;
      // A command runs inside powershell so npm shims like `claude` resolve;
      // no command means an interactive shell pane.
      const args = msg.cmd
        ? ['-NoLogo', '-NoProfile', '-Command', msg.cmd]
        : ['-NoLogo'];
      try {
        proc = pty.spawn('powershell.exe', args, {
          name: 'xterm-256color',
          cols: msg.cols || 100,
          rows: msg.rows || 30,
          cwd,
          env: process.env,
        });
      } catch (e) {
        ws.send(JSON.stringify({ type: 'exit', error: String(e) }));
        return;
      }
      proc.onData((d) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', data: d }));
      });
      proc.onExit(({ exitCode }) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        proc = null;
      });
    } else if (msg.type === 'input' && proc) {
      proc.write(msg.data);
    } else if (msg.type === 'resize' && proc) {
      try { proc.resize(msg.cols, msg.rows); } catch {}
    }
  });

  ws.on('close', () => {
    if (proc) try { proc.kill(); } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`ClawCanvas running → http://localhost:${PORT}`);
});
