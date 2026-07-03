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

// ---- OpenClaw fleet relay: CLAW can ask the business agents questions ----

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || path.join(process.env.USERPROFILE, '.openclaw');

// spoken name -> gateway agent id ("arlo" lives at id main; "intern" at id hudson)
const FLEET = {
  arlo: 'main', main: 'main',
  anders: 'anders',
  simon: 'simon',
  intern: 'hudson', hudson: 'hudson',
  senra: 'senra',
  graham: 'graham',
};

function openclawConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(OPENCLAW_DIR, 'openclaw.json'), 'utf8'));
  return {
    port: (cfg.gateway && cfg.gateway.port) || 18789,
    token: (cfg.gateway && cfg.gateway.auth && cfg.gateway.auth.token) || '',
  };
}

app.post('/api/openclaw', async (req, res) => {
  const { agent, text } = req.body;
  const id = FLEET[String(agent || '').toLowerCase()];
  if (!id) return res.json({ error: `unknown fleet agent: ${agent}` });
  try {
    const { port, token } = openclawConfig();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 180000);
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: `openclaw/${id}`,
        user: 'clawcanvas', // stable session key so follow-ups share context
        messages: [{ role: 'user', content: text }],
      }),
    });
    clearTimeout(t);
    if (!r.ok) {
      return res.json({ error: `gateway ${r.status}: ${(await r.text()).slice(0, 200)}` });
    }
    const data = await r.json();
    res.json({ reply: (data.choices && data.choices[0] && data.choices[0].message.content) || '(no reply)' });
  } catch (e) {
    res.json({ error: String(e) });
  }
});

// ---- CLAW orchestrator brain: transcript -> claude -p (haiku) -> JSON actions ----

// Sonnet by default — smart enough to read terminal output and route/answer.
// Switch without editing code:  set CLAW_MODEL=haiku (fast)  or  =opus (deepest).
const ORCH_MODEL = process.env.CLAW_MODEL || 'sonnet';

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

// Render each agent with the tail of what it's actually showing on screen, so
// the brain can route by activity ("the one doing the scraper") and answer about
// state — not just match callsigns.
function renderAgents(agents) {
  if (!agents.length) return '(none open)';
  return agents.map((a) => {
    const tag = [a.name, a.running ? 'running' : 'stopped', a.target ? 'CURRENT-TARGET' : '']
      .filter(Boolean).join(' · ');
    const ctx = a.context
      ? `\n    recent output:\n${a.context.split('\n').map((l) => '    | ' + l).join('\n')}`
      : '\n    recent output: (none)';
    return `- ${tag}  [folder: ${a.cwd || '?'}]${ctx}`;
  }).join('\n');
}

function renderHistory(history) {
  if (!history || !history.length) return '';
  const lines = history.map((h) => `${h.who === 'you' ? 'Derek' : 'CLAW'}: ${h.text}`).join('\n');
  return `\nRecent conversation (for follow-up context):\n${lines}\n`;
}

const MODELS = ['haiku', 'sonnet', 'opus'];

app.post('/api/orchestrate', (req, res) => {
  const { transcript, agents = [], folders = [], lastCwd, history = [], screen } = req.body;
  const model = MODELS.includes(req.body.model) ? req.body.model : ORCH_MODEL;
  const screenLine = screen && screen.w
    ? `Derek's screen is ${screen.w}x${screen.h} px. The canvas already knows this — never ask him for his screen or monitor size.`
    : '';
  const prompt = `You are CLAW, the voice orchestrator for ClawCanvas — a canvas of terminal panes, each running a Claude Code agent, on Derek's Windows machine. You can SEE what each agent is doing via the recent-output snippets below. Talk to Derek like a sharp, easygoing chief of staff who remembers the conversation.

Agents on canvas (with what's on their screen right now):
${renderAgents(agents)}

Known project folders: ${JSON.stringify(folders)}
Default folder: ${JSON.stringify(lastCwd)}
${screenLine}
${renderHistory(history)}
Derek just said (speech-to-text, may contain transcription errors): ${JSON.stringify(transcript)}

USE WHAT YOU ALREADY KNOW. You have the conversation history, the agents and their output, the folders, and the screen size above. Answer and act from that. NEVER ask Derek for something you can already see (his screen size, what an agent is doing, what he said a moment ago). If a request refers back to earlier ("do that", "the one I mentioned", "make it fit"), resolve it from the history.

Decide what to do. Situations:

A) COMMAND (spawn / send an instruction / close / broadcast / arrange). Keep "say" a short spoken confirmation. Actions:
- {"type":"spawn","cwd":"C:\\\\full\\\\path","cmd":"claude"} — open a new agent. Pick a known folder if he names one (fuzzy match fine), else the default. cmd is "claude", or "claude --continue" to resume.
- {"type":"send","target":"AGENTNAME"|"all","text":"..."} — give an agent an instruction. IMPORTANT: he may describe the agent by WHAT IT'S DOING ("the one doing the scraper", "the github with the failing tests") — use the recent output above to pick the right callsign. Callsigns: rook, juno, vega, atlas, nova, orion, lyra, onyx, echo, milo.
- {"type":"close","target":"AGENTNAME"}
- {"type":"arrange"} — tidy/tile ALL the panes into a neat grid that fits the screen. Use this whenever he asks to fit, arrange, organize, tidy, line up, or make the tiles/terminals fit the canvas or screen. You know his screen size, so just do it.
- {"type":"openclaw","agent":"arlo","text":"..."} — relay to Derek's OpenClaw BUSINESS fleet: arlo (chief of staff), simon (Bobola's restaurant), intern (food truck / ice cream / speedway concessions), senra (research), anders (dev/product), graham (Market Historian X). Use when he addresses one of these names or asks a business/ops question.

B) QUESTION about his agents or the canvas. READ the output above and actually answer:
- "say": a concise SPOKEN digest (1-2 sentences, natural).
- "detail": the fuller written answer — name the agents and cite what you see. Markdown. Omit if "say" already covers it.
- optionally "artifact": {"format":"status"} live fleet board, {"format":"markdown","content":"..."}, or {"format":"mermaid","content":"graph TD; ..."} (keep mermaid simple/valid).

Writing style: no em dashes. Be specific, not fluffy. Don't say "depends" when you have the facts.

CRITICAL: Do not use any tools. Do not read or write any files. Reply with RAW JSON only — no markdown fences, no commentary:
{"say":"...","detail":"...(optional)","artifact":{...}(optional),"actions":[...]}`;

  let sent = false;
  const done = (payload) => { if (!sent) { sent = true; res.json(payload); } };

  const child = spawn('cmd.exe', ['/c', 'claude', '-p', '--model', model], {
    cwd: __dirname,
    windowsHide: true,
  });
  const timer = setTimeout(() => { try { child.kill(); } catch {} }, 60000);
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
