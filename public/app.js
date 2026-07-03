/* ClawCanvas — infinite canvas of agent terminals, notes, and voice control */

const TerminalCtor = window.Terminal.Terminal || window.Terminal;
const FitCtor = window.FitAddon.FitAddon || window.FitAddon;

const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const zoomLabel = document.getElementById('zoom-label');

const camera = { x: 0, y: 0, z: 1 };
const panes = new Map(); // id -> pane record
let voiceTargetId = null;
let lastCwd = 'C:\\Users\\Derek';

// agents get callsigns so you can route voice commands by name
const ROSTER = ['ROOK', 'JUNO', 'VEGA', 'ATLAS', 'NOVA', 'ORION', 'LYRA', 'ONYX', 'ECHO', 'MILO'];
function nextName() {
  const used = new Set([...panes.values()].map((p) => p.name));
  return ROSTER.find((n) => !used.has(n)) || 'AGENT' + (panes.size + 1);
}

// muted second line under the callsign, e.g. "Claude Code · dbclaw-os"
function paneSubtitle(p) {
  if (p.type === 'note') return '';
  const tool = p.cmd ? (/claude/i.test(p.cmd) ? 'Claude Code' : p.cmd.split(/\s+/)[0]) : 'PowerShell';
  const folder = p.cwd ? p.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
  return folder ? `${tool} · ${folder}` : tool;
}

/* ---------- camera ---------- */

function applyCamera() {
  world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`;
  zoomLabel.textContent = Math.round(camera.z * 100) + '%';
  scheduleSave();
}

function screenToWorld(sx, sy) {
  return { x: (sx - camera.x) / camera.z, y: (sy - camera.y) / camera.z };
}

function zoomAt(sx, sy, factor) {
  const z2 = Math.min(2.5, Math.max(0.15, camera.z * factor));
  camera.x = sx - ((sx - camera.x) / camera.z) * z2;
  camera.y = sy - ((sy - camera.y) / camera.z) * z2;
  camera.z = z2;
  applyCamera();
}

viewport.addEventListener('wheel', (e) => {
  const overPane = e.target.closest('.pane');
  if (overPane && !e.ctrlKey) return; // let terminals scroll their buffer
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012));
}, { passive: false });

let panState = null;
viewport.addEventListener('pointerdown', (e) => {
  const onBackground = e.target === viewport || e.target === world;
  if (!onBackground && e.button !== 1) return;
  panState = { sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y };
  viewport.classList.add('panning');
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener('pointermove', (e) => {
  if (!panState) return;
  camera.x = panState.cx + (e.clientX - panState.sx);
  camera.y = panState.cy + (e.clientY - panState.sy);
  applyCamera();
});
viewport.addEventListener('pointerup', () => {
  panState = null;
  viewport.classList.remove('panning');
});

document.getElementById('btn-home').onclick = () => {
  camera.x = 0; camera.y = 0; camera.z = 1;
  applyCamera();
};

document.getElementById('btn-tidy').onclick = arrangeGrid;

/* ---------- panes ---------- */

let spawnCascade = 0;

function nextSpawnPos(w, h) {
  const c = screenToWorld(innerWidth / 2, innerHeight / 2);
  spawnCascade = (spawnCascade + 1) % 8;
  return { x: c.x - w / 2 + spawnCascade * 34, y: c.y - h / 2 + spawnCascade * 34 };
}

// the usable board area = viewport minus the topbar and any open side panels
function workingArea() {
  const pad = 20, top = 70;
  const left = (clawPanel && clawPanel.classList.contains('open') ? clawPanel.offsetWidth : 0) + pad;
  const right = (artifactPanel && artifactPanel.classList.contains('open') ? artifactPanel.offsetWidth : 0) + pad;
  return { left, top, w: Math.max(320, innerWidth - left - right), h: Math.max(300, innerHeight - top - pad) };
}

// tile every pane into a clean grid — no infinite-void scatter. Sized so 6-8
// terminals/notes sit organized in the working area.
function arrangeGrid() {
  const list = [...panes.values()];
  if (!list.length) return;
  const gap = 16;
  const a = workingArea();
  const n = list.length;
  let cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  cols = Math.max(1, Math.min(cols, Math.floor((a.w + gap) / (340 + gap)) || 1));
  const rows = Math.ceil(n / cols);
  const cellW = (a.w - gap * (cols - 1)) / cols;
  const cellH = Math.max(240, Math.min(470, (a.h - gap * (rows - 1)) / rows));
  camera.x = 0; camera.y = 0; camera.z = 1; applyCamera();
  list.forEach((p, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    p.x = a.left + c * (cellW + gap);
    p.y = a.top + r * (cellH + gap);
    p.w = Math.round(cellW);
    p.h = Math.round(cellH);
    p.el.style.left = p.x + 'px';
    p.el.style.top = p.y + 'px';
    p.el.style.width = p.w + 'px';
    p.el.style.height = p.h + 'px';
    if (p.fit) fitTerm(p);
  });
  scheduleSave();
}

function createPane(opts) {
  const p = {
    id: opts.id || crypto.randomUUID(),
    type: opts.type,                    // 'term' | 'note'
    x: opts.x, y: opts.y,
    w: opts.w || (opts.type === 'note' ? 320 : 720),
    h: opts.h || (opts.type === 'note' ? 260 : 460),
    title: opts.title || 'PANE',
    name: opts.name || null,            // voice callsign for agents
    cmd: opts.cmd || null,              // null cmd on a term = plain shell
    cwd: opts.cwd || null,
    content: opts.content || '',
    ws: null, term: null, fit: null, el: null,
  };

  const el = document.createElement('div');
  el.className = `pane ${p.type === 'note' ? 'note' : ''}`;
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  el.style.width = p.w + 'px';
  el.style.height = p.h + 'px';
  el.innerHTML = `
    <div class="pane-head">
      <span class="dot"></span>
      <div class="pane-titles">
        <span class="pane-title"></span>
        <span class="pane-sub"></span>
      </div>
      <span class="needs-badge">⏳ needs you</span>
      <span class="head-spacer"></span>
      ${p.type === 'term' ? '<button class="head-btn btn-target" title="Set as voice target">◉</button>' : ''}
      <button class="head-btn btn-close" title="Close">✕</button>
    </div>
    <div class="pane-body"></div>
    <div class="grip"></div>`;
  el.querySelector('.pane-title').textContent = p.title;
  el.querySelector('.pane-sub').textContent = paneSubtitle(p);
  world.appendChild(el);
  p.el = el;
  panes.set(p.id, p);

  // focus on any interaction
  el.addEventListener('pointerdown', () => focusPane(p.id));

  // drag by header
  const head = el.querySelector('.pane-head');
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.head-btn')) return;
    e.stopPropagation();
    focusPane(p.id);
    const start = { sx: e.clientX, sy: e.clientY, px: p.x, py: p.y };
    const move = (ev) => {
      p.x = start.px + (ev.clientX - start.sx) / camera.z;
      p.y = start.py + (ev.clientY - start.sy) / camera.z;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      scheduleSave();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  // resize by grip
  el.querySelector('.grip').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const start = { sx: e.clientX, sy: e.clientY, w: p.w, h: p.h };
    const move = (ev) => {
      p.w = Math.max(260, start.w + (ev.clientX - start.sx) / camera.z);
      p.h = Math.max(140, start.h + (ev.clientY - start.sy) / camera.z);
      el.style.width = p.w + 'px';
      el.style.height = p.h + 'px';
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (p.fit) fitTerm(p);
      scheduleSave();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  el.querySelector('.btn-close').addEventListener('click', () => closePane(p.id));

  const targetBtn = el.querySelector('.btn-target');
  if (targetBtn) targetBtn.addEventListener('click', () => setVoiceTarget(p.id));

  // rename on double-click
  el.querySelector('.pane-title').addEventListener('dblclick', () => {
    const name = prompt('Pane name:', p.title);
    if (name) { p.title = name; el.querySelector('.pane-title').textContent = name; scheduleSave(); }
  });

  if (p.type === 'note') buildNote(p);
  focusPane(p.id);
  scheduleSave();
  return p;
}

let zTop = 10;
function focusPane(id) {
  for (const [pid, p] of panes) p.el.classList.toggle('focused', pid === id);
  const p = panes.get(id);
  if (!p) return;
  // bring to front — must be z-index, not appendChild: re-attaching the node
  // mid-pointerdown cancels the click and the terminal never gets focus
  p.el.style.zIndex = ++zTop;
  if (p.type === 'term') {
    setVoiceTarget(id);
    if (p.term) p.term.focus();
  }
}

function closePane(id) {
  const p = panes.get(id);
  if (!p) return;
  if (p.ws) try { p.ws.close(); } catch {}
  if (p.term) try { p.term.dispose(); } catch {}
  p.el.remove();
  panes.delete(id);
  if (voiceTargetId === id) voiceTargetId = null;
  scheduleSave();
}

function setVoiceTarget(id) {
  voiceTargetId = id;
  for (const [pid, p] of panes) {
    const btn = p.el.querySelector('.btn-target');
    if (btn) btn.classList.toggle('target-on', pid === id);
  }
}

/* ---------- notes ---------- */

function buildNote(p) {
  const body = p.el.querySelector('.pane-body');
  const ta = document.createElement('textarea');
  ta.value = p.content;
  ta.placeholder = 'scratch pad…';
  ta.spellcheck = false;
  ta.addEventListener('input', () => { p.content = ta.value; scheduleSave(); });
  body.appendChild(ta);
}

/* ---------- terminals ---------- */

function fitTerm(p) {
  if (!p.fit) return;
  try {
    p.fit.fit();
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({ type: 'resize', cols: p.term.cols, rows: p.term.rows }));
    }
  } catch {}
}

function launchTerm(p) {
  const body = p.el.querySelector('.pane-body');
  body.innerHTML = '';

  const term = new TerminalCtor({
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 8000,
    theme: {
      background: '#0b0d12',
      foreground: '#cdd6e4',
      cursor: '#ff7a52',
      selectionBackground: 'rgba(255, 122, 82, 0.3)',
      black: '#1a1f2b', brightBlack: '#5d6a80',
      red: '#ff3b5c', brightRed: '#ff6b85',
      green: '#3ddc84', brightGreen: '#6ce8a3',
      yellow: '#ffb454', brightYellow: '#ffcd8a',
      blue: '#5ca9ff', brightBlue: '#8cc2ff',
      magenta: '#c792ea', brightMagenta: '#dcb3f2',
      cyan: '#56d4dd', brightCyan: '#87e2e8',
      white: '#cdd6e4', brightWhite: '#ffffff',
    },
  });
  const fit = new FitCtor();
  term.loadAddon(fit);
  term.open(body);
  p.term = term;
  p.fit = fit;
  fit.fit();

  const ws = new WebSocket(`ws://${location.host}/term`);
  p.ws = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'spawn', cmd: p.cmd, cwd: p.cwd,
      cols: term.cols, rows: term.rows,
    }));
    p.el.classList.add('running');
    p.el.classList.remove('dead');
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'data') {
      term.write(msg.data);
      // keep a small rolling tail of raw output to scan for "needs you" prompts
      p.tail = ((p.tail || '') + msg.data).slice(-2500);
      clearTimeout(p.needsTimer);
      p.needsTimer = setTimeout(() => checkNeedsYou(p), 400);
    }
    else if (msg.type === 'exit') {
      p.el.classList.remove('running');
      p.el.classList.add('dead');
      term.write(`\r\n\x1b[38;5;203m[process exited${msg.code != null ? ' · code ' + msg.code : ''}]\x1b[0m\r\n`);
      showLaunchOverlay(p, 'RELAUNCH');
    }
  };
  ws.onclose = () => {
    if (p.el.classList.contains('running')) {
      p.el.classList.remove('running');
      p.el.classList.add('dead');
    }
  };
  term.onData((d) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data: d }));
  });

  // refit when the pane is resized by any means
  new ResizeObserver(() => fitTerm(p)).observe(body);
}

function showLaunchOverlay(p, label) {
  const body = p.el.querySelector('.pane-body');
  const overlay = document.createElement('div');
  overlay.className = 'launch-overlay';
  overlay.innerHTML = `
    <div class="cmd"></div>
    <button>▶ ${label}</button>`;
  overlay.querySelector('.cmd').textContent = `${p.cmd || 'powershell'} — ${p.cwd || '~'}`;
  overlay.querySelector('button').addEventListener('click', () => {
    overlay.remove();
    launchTerm(p);
  });
  body.appendChild(overlay);
}

/* ---------- spawning ---------- */

document.getElementById('btn-shell').onclick = () => {
  const pos = nextSpawnPos(720, 460);
  const p = createPane({ type: 'term', title: 'SHELL', cmd: null, cwd: lastCwd, ...pos });
  launchTerm(p);
  arrangeGrid();
};

document.getElementById('btn-note').onclick = () => {
  const pos = nextSpawnPos(320, 260);
  createPane({ type: 'note', title: 'NOTE', ...pos });
  arrangeGrid();
};

// agent spawn modal
const backdrop = document.getElementById('modal-backdrop');
const presetSel = document.getElementById('spawn-preset');
const customRow = document.getElementById('custom-cmd-row');
const cmdInput = document.getElementById('spawn-cmd');
const cwdInput = document.getElementById('spawn-cwd');

document.getElementById('btn-agent').onclick = () => {
  cwdInput.value = lastCwd;
  refreshCwdHistory();
  backdrop.classList.remove('hidden');
  cwdInput.focus();
};
presetSel.onchange = () => customRow.classList.toggle('hidden', presetSel.value !== '__custom');
document.getElementById('spawn-cancel').onclick = () => backdrop.classList.add('hidden');
backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) backdrop.classList.add('hidden'); });

document.getElementById('spawn-go').onclick = () => {
  const cmd = presetSel.value === '__custom' ? (cmdInput.value.trim() || 'claude') : presetSel.value;
  const cwd = cwdInput.value.trim() || lastCwd;
  backdrop.classList.add('hidden');
  spawnAgent(cwd, cmd);
};

function spawnAgent(cwd, cmd = 'claude') {
  lastCwd = cwd;
  const folder = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd;
  const name = nextName();
  const pos = nextSpawnPos(720, 460);
  const p = createPane({ type: 'term', title: name, name, cmd, cwd, ...pos });
  launchTerm(p);
  arrangeGrid();
  speak(`${name.toLowerCase()} is up`);
  return p;
}

function refreshCwdHistory() {
  const list = document.getElementById('cwd-history');
  const seen = new Set();
  list.innerHTML = '';
  for (const p of panes.values()) {
    if (p.cwd && !seen.has(p.cwd)) {
      seen.add(p.cwd);
      const o = document.createElement('option');
      o.value = p.cwd;
      list.appendChild(o);
    }
  }
}

/* ---------- voice ---------- */

const micBtn = document.getElementById('btn-mic');
const voiceHud = document.getElementById('voice-hud');
const voiceText = document.getElementById('voice-text');
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_OK = !!SR;
const NO_SPEECH_MSG =
  'Voice needs Edge or Chrome — Firefox and Brave block the Web Speech API.\n\n' +
  'You can still TYPE commands in the CLAW box (bottom of the face panel) right now.\n\n' +
  'For voice: close this window and double-click start-clawcanvas.cmd, or open ' +
  'http://localhost:18790 in Microsoft Edge.';
let recog = null;
let listening = false;
let voiceDiscard = false;

function startListening() {
  if (!SR) { alert(NO_SPEECH_MSG); return; }
  if (conversationMode) return; // conversation mode owns the mic
  if (listening) return;
  listening = true;
  voiceDiscard = false;
  recog = new SR();
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = 'en-US';

  let finalText = '';
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    voiceText.textContent = (finalText + interim) || 'listening…';
  };
  recog.onend = () => {
    if (listening) { try { recog.start(); } catch {} return; } // keep alive while held
    const text = finalText.trim();
    voiceHud.classList.add('hidden');
    micBtn.classList.remove('listening');
    if (text && !voiceDiscard) orchestrate(text);
  };
  recog.onerror = () => {};

  voiceText.textContent = 'listening…';
  voiceHud.classList.remove('hidden');
  micBtn.classList.add('listening');
  recog.start();
}

function stopListening() {
  if (!listening) return;
  listening = false;
  try { recog.stop(); } catch {}
}

// bail out without sending — used when Ctrl turns out to be a shortcut combo
function abortListening() {
  if (!listening) return;
  voiceDiscard = true;
  listening = false;
  try { recog.abort(); } catch {}
}

// Edge ships Azure neural voices ("... Online (Natural)") for free — prefer
// those over the robotic SAPI defaults. Click the CLAW header to cycle voices.
let voiceList = [];
let clawVoice = null;

const isNatural = (v) => v && /Online \(Natural\)/i.test(v.name);

function refreshVoices() {
  const all = speechSynthesis.getVoices();
  if (!all.length) return; // transient empty — keep whatever we have
  const natural = all.filter((v) => isNatural(v) && v.lang.startsWith('en'));
  voiceList = natural.length ? natural : all.filter((v) => v.lang.startsWith('en'));

  const saved = localStorage.getItem('clawVoice');
  const bySaved = voiceList.find((v) => v.name === saved);
  if (bySaved) { clawVoice = bySaved; return; }

  // once we've locked onto a natural voice, never downgrade back to robotic
  if (isNatural(clawVoice)) return;

  const pick =
    voiceList.find((v) => /Andrew/i.test(v.name)) ||   // warm male neural
    voiceList.find((v) => /Brian|Christopher|Guy/i.test(v.name)) ||
    voiceList.find((v) => /Aria|Ava|Emma|Jenny/i.test(v.name)) ||
    voiceList[0] || null;

  if (pick) clawVoice = pick;
}
speechSynthesis.onvoiceschanged = refreshVoices;
refreshVoices();
// neural voices are fetched over the network and can arrive a beat late — keep
// checking so we upgrade off the robotic local voice as soon as they show up.
[400, 1200, 3000, 6000].forEach((ms) => setTimeout(refreshVoices, ms));

let clawSpeaking = false; // true while CLAW's TTS is playing (echo guard for conversation mode)

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (clawVoice) u.voice = clawVoice;
    u.rate = 1.08;
    u.onstart = () => { clawSpeaking = true; setMood('talking'); };
    u.onend = () => { clawSpeaking = false; setMood('idle'); };
    u.onerror = () => { clawSpeaking = false; setMood('idle'); };
    speechSynthesis.speak(u);
  } catch {}
}

// drive the CLAW face: idle | thinking | talking | alert
const MOOD_LABEL = { idle: 'listening', thinking: 'thinking…', talking: 'speaking', alert: 'heads up' };
function setMood(mood) {
  const f = document.getElementById('claw-face');
  if (!f) return;
  f.classList.remove('mood-idle', 'mood-thinking', 'mood-talking', 'mood-alert');
  f.classList.add('mood-' + mood);
  const m = document.querySelector('.cp-mood');
  if (m) m.textContent = MOOD_LABEL[mood] || '';
}

function findAgent(word) {
  if (!word) return null;
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...panes.values()].find((p) => p.name && p.name.toLowerCase() === w) || null;
}

function sendText(p, text) {
  if (!p || !p.ws || p.ws.readyState !== 1) return false;
  p.ws.send(JSON.stringify({ type: 'input', data: text }));
  setTimeout(() => {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'input', data: '\r' }));
  }, 200);
  clearNeedsYou(p);           // sending input un-blocks the pane
  focusPane(p.id);
  return true;
}

// Read the last N non-blank lines a terminal is showing, so CLAW can see what
// each agent is actually doing. Returns null for panes with no live terminal.
function readTail(p, maxLines = 40) {
  if (!p.term) return null;
  try {
    const buf = p.term.buffer.active;
    const lines = [];
    const start = Math.max(0, buf.length - 240);
    for (let i = start; i < buf.length; i++) {
      const ln = buf.getLine(i);
      if (ln) lines.push(ln.translateToString(true).replace(/\s+$/, '').slice(0, 200));
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop(); // drop trailing blanks
    const tail = lines.slice(-maxLines).join('\n').trim();
    return tail || null;
  } catch { return null; }
}

// one-line summary of a pane for the status board
function paneLastLine(p) {
  const t = readTail(p, 6);
  if (!t) return p.el.classList.contains('dead') ? '(stopped)' : '(no output yet)';
  const lines = t.split('\n').filter((l) => l.trim());
  return (lines[lines.length - 1] || '').slice(0, 80);
}

/* ---------- "needs you" alerts ----------
   Watch each terminal's output for a Claude Code permission/confirm prompt and
   flag the pane + say its name once, so a blocked agent can't hide off-screen. */

const NEEDS_YOU_RE = /(Do you want to proceed|Do you want to make this edit|Yes, and don't ask again|❯\s*1\.\s*Yes|\(y\/n\)|\[y\/N\]|Press\s+\w+\s+to continue)/i;

function checkNeedsYou(p) {
  if (!p || p.type !== 'term') return;
  const blocked = NEEDS_YOU_RE.test(p.tail || '');
  if (blocked && !p.needsYou) {
    p.needsYou = true;
    p.el.classList.add('needs-you');
    speak(`${(p.name || 'an agent').toLowerCase()} needs you`);
  } else if (!blocked && p.needsYou) {
    clearNeedsYou(p);
  }
}

function clearNeedsYou(p) {
  if (p && p.needsYou) {
    p.needsYou = false;
    p.el.classList.remove('needs-you');
  }
}

/* ---------- CLAW brain ----------
   Every transcript goes to the server, which asks Claude (haiku) to turn it
   into actions: spawn / send / close / say. Regex router below is the
   offline fallback. */

const clawLogEl = document.getElementById('claw-log');
const clawInput = document.getElementById('claw-input');
const clawDot = document.querySelector('.cp-dot');

const clawHistory = []; // last few turns, for follow-up context
let clawFacts = [];     // durable facts CLAW remembers across sessions

async function loadFacts() {
  try { const m = await (await fetch('/api/memory')).json(); clawFacts = m.facts || []; } catch {}
}
loadFacts();

// save a durable fact and keep it in memory for this session too
async function rememberFact(text) {
  const t = String(text || '').trim();
  if (!t) return;
  if (!clawFacts.some((f) => (f.text || f) === t)) clawFacts.push({ text: t });
  try { await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) }); } catch {}
}

function clawLog(who, text) {
  const div = document.createElement('div');
  div.className = 'cp-line ' + who;
  div.textContent = (who === 'you' ? '› ' : '⚡ ') + text;
  clawLogEl.appendChild(div);
  clawLogEl.scrollTop = clawLogEl.scrollHeight;
  if (who === 'you' || who === 'claw') {
    clawHistory.push({ who, text });
    if (clawHistory.length > 16) clawHistory.shift();
  }
}

async function orchestrate(text) {
  // local shortcuts handled instantly, no round-trip (also work offline)
  if (localCommand(text)) return;

  clawLog('you', text);
  clawDot.classList.add('thinking');
  setMood('thinking');
  try {
    const body = {
      transcript: text,
      lastCwd,
      model: clawModel,
      screen: { w: innerWidth, h: innerHeight },
      facts: clawFacts,
      history: clawHistory.slice(-10),
      agents: [...panes.values()]
        .filter((p) => p.type === 'term' && p.name)
        .map((p) => ({
          name: p.name,
          cwd: p.cwd,
          running: !!(p.ws && p.ws.readyState === 1),
          target: p.id === voiceTargetId,
          context: readTail(p),
        })),
      folders: [...new Set([...panes.values()].map((p) => p.cwd).filter(Boolean).concat(lastCwd))],
    };
    const r = await fetch('/api/orchestrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    const spawned = []; // brain can't know the callsign a new agent will get,
                        // so sends to unknown names route to this batch's spawns
    for (const a of data.actions || []) {
      if (a.type === 'spawn') {
        spawned.push(spawnAgent(a.cwd || lastCwd, a.cmd || 'claude'));
      } else if (a.type === 'send') {
        if ((a.target || '').toLowerCase() === 'all') {
          for (const p of panes.values()) if (p.type === 'term' && p.name) sendText(p, a.text);
        } else {
          const p = findAgent(a.target) || spawned[spawned.length - 1];
          if (p && spawned.includes(p)) {
            // give a fresh claude pane time to boot before the instruction lands
            clawLog('claw', `queued for ${p.name} (booting…)`);
            setTimeout(() => sendText(p, a.text), 7000);
          } else if (p) {
            sendText(p, a.text);
          } else {
            clawLog('claw', `no agent named ${a.target}`);
          }
        }
      } else if (a.type === 'close') {
        const p = findAgent(a.target);
        if (p) closePane(p.id);
      } else if (a.type === 'arrange' || a.type === 'tidy') {
        arrangeGrid();
      } else if (a.type === 'remember') {
        rememberFact(a.text);
      } else if (a.type === 'open') {
        openApp(a.app);
      } else if (a.type === 'search') {
        research(a.query || a.text);
      } else if (a.type === 'openclaw') {
        askFleet(a.agent, a.text); // fire and continue — fleet turns take a while
      }
    }
    if (data.say) { speak(data.say); clawLog('claw', data.say); }
    if (data.detail) renderArtifact({ format: 'markdown', content: data.detail });
    if (data.artifact) renderArtifact(data.artifact);
  } catch (e) {
    clawLog('claw', 'brain offline — using direct routing');
    handleVoice(text);
  } finally {
    clawDot.classList.remove('thinking');
    setMood('idle');
  }
}

/* ---------- local voice shortcuts (no round-trip, work offline) ---------- */
function localCommand(text) {
  const t = text.trim().toLowerCase();

  // instant small talk — never hit the Claude CLI for a plain "hello"
  if (/^((hi|hey+|hello+|yo|sup|hiya|howdy)( there| claw)?|you there|are you there|how are you|how'?s it going|what'?s up|good (morning|afternoon|evening|night))[\s!,.?]*$/i.test(t)) {
    clawLog('you', text);
    const r = ['hey Derek, what do you need?', "hey, I'm here. what's up?", 'yep, right here. what do you need?', "hey. ready when you are."];
    const line = r[Math.floor(Math.random() * r.length)];
    speak(line); clawLog('claw', line);
    return true;
  }
  if (/^(thanks|thank you|thx|ty|good job|nice|awesome|great job|perfect|love it|well done|appreciate it)[\s!,.]*$/i.test(t)) {
    clawLog('you', text);
    const line = ['anytime.', 'you got it.', 'happy to help.'][Math.floor(Math.random() * 3)];
    speak(line); clawLog('claw', line);
    return true;
  }

  if (/^(show me the menu|show menu|what can you do|help|menu)\b/.test(t)) {
    clawLog('you', text);
    renderArtifact({ format: 'menu' });
    speak('here is what I can do');
    clawLog('claw', 'menu is up in the panel');
    return true;
  }
  if (/(conversation mode|start conversation|keep listening|hands.?free)/.test(t)) {
    clawLog('you', text);
    startConversation();
    return true;
  }
  if (/(stop listening|stop conversation|exit conversation|that'?s all|go to sleep)/.test(t)) {
    clawLog('you', text);
    stopConversation();
    return true;
  }
  if (/(status board|fleet status|status of everyone|show.*status)/.test(t)) {
    clawLog('you', text);
    renderArtifact({ format: 'status' });
    speak('here is the fleet');
    return true;
  }
  // open an app / site / URL
  let mo = t.match(/^(?:open|launch|go to|pull up)\s+(https?:\/\/\S+)/);
  if (mo) { clawLog('you', text); openApp(mo[1]); return true; }
  mo = t.match(/^(?:open|launch|pull up|bring up|fire up)\s+(?:the\s+|up\s+|my\s+)?(browser|chrome|edge|firefox|vs ?code|visual studio code|notepad|file explorer|explorer|files|calculator|calc|spotify|windows terminal|terminal|powershell|paint|word|excel|outlook|settings|youtube|gmail|google|github|twitter|chatgpt|claude|maps)\b/);
  if (mo) { clawLog('you', text); openApp(mo[1]); return true; }
  // web search
  let ms = t.match(/^(?:search(?: the web)?(?: for)?|google|web search|search up|look ?up)\s+(.+)/);
  if (ms && ms[1]) { clawLog('you', text); research(ms[1]); return true; }
  ms = t.match(/^what'?s (?:the latest|new|happening|going on)(?: on| with| in| about)?\s+(.+)/);
  if (ms && ms[1]) { clawLog('you', text); research(ms[1]); return true; }
  if (/(tidy|arrange|organi[sz]e|clean up|line.*up|grid|fit .*(canvas|screen|window|terminal)|make .*(fit|tiles fit)|fit the (tiles|terminals|panes|windows))/.test(t)) {
    clawLog('you', text);
    arrangeGrid();
    speak('all tidied up');
    return true;
  }
  if (/(hide your face|hide the face|hide yourself|minimize yourself|go small)/.test(t)) {
    setCompanion(false);
    return true;
  }
  if (/(show your face|show yourself|come back|full screen)/.test(t)) {
    setCompanion(true);
    speak('here I am');
    return true;
  }
  return false;
}

// click the CLAW header to audition/cycle voices; choice is remembered
document.querySelector('.cp-head').addEventListener('click', () => {
  if (!voiceList.length) return;
  clawVoice = voiceList[(voiceList.indexOf(clawVoice) + 1) % voiceList.length];
  localStorage.setItem('clawVoice', clawVoice.name);
  const short = (clawVoice.name.match(/Microsoft (\w+)/) || [null, clawVoice.name])[1];
  speak(`this is ${short}`);
  clawLog('claw', `voice: ${short}`);
});

// relay to the OpenClaw business fleet (arlo/simon/intern/senra/anders/graham)
// and speak the reply back
async function askFleet(agent, text) {
  const who = (agent || '').toLowerCase();
  clawLog('claw', `asking ${who}…`);
  clawDot.classList.add('thinking');
  try {
    const r = await fetch('/api/openclaw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: who, text }),
    });
    const data = await r.json();
    if (data.error) { clawLog('claw', `fleet: ${data.error}`); speak(`${who} didn't answer`); return; }
    clawLog('claw', `${who}: ${data.reply}`);
    // speak a digest — fleet replies can be long; full text stays in the log
    const clean = data.reply.replace(/[*_#`|]/g, ' ').replace(/\s+/g, ' ').trim();
    speak(clean.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ').slice(0, 450));
  } catch (e) {
    clawLog('claw', `fleet relay failed: ${e.message}`);
  } finally {
    clawDot.classList.remove('thinking');
  }
}

// launch an app or website on Derek's PC
async function openApp(app) {
  if (!app) return;
  clawLog('claw', `opening ${app}…`);
  try {
    const r = await (await fetch('/api/open', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app }),
    })).json();
    if (r.error) { speak(`couldn't open ${app}`); clawLog('claw', `open failed: ${r.error}`); }
    else { speak(`opening ${app}`); }
  } catch (e) { speak(`couldn't open ${app}`); clawLog('claw', String(e)); }
}

// search the web (Exa) and answer
async function research(query) {
  const q = String(query || '').trim();
  if (!q) return;
  clawLog('claw', `searching the web for "${q}"…`);
  clawDot.classList.add('thinking'); setMood('thinking');
  try {
    const r = await (await fetch('/api/research', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, model: clawModel }),
    })).json();
    if (r.error === 'no-exa-key') {
      const m = 'Web search needs an Exa API key. Get one free at exa.ai, then paste it into `data/exa.key` (or set the EXA_API_KEY env var) and restart.';
      speak("web search isn't set up yet — you need an Exa key"); clawLog('claw', m);
      renderArtifact({ format: 'markdown', content: '### Web search not set up\n' + m });
      return;
    }
    if (r.error) { speak('web search hit a snag'); clawLog('claw', `search error: ${r.error}`); return; }
    if (r.say) { speak(r.say); clawLog('claw', r.say); }
    if (r.artifact) renderArtifact(r.artifact);
  } catch (e) { speak('web search failed'); clawLog('claw', String(e)); }
  finally { clawDot.classList.remove('thinking'); setMood('idle'); }
}

clawInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && clawInput.value.trim()) {
    orchestrate(clawInput.value.trim());
    clawInput.value = '';
  }
});

/* Fallback router (no brain): route by callsign, broadcast, close, or fall
   through to the current voice target. */
function handleVoice(text) {
  let m;

  m = text.match(/^(?:everyone|all agents|broadcast)[,:]?\s+(.+)/i);
  if (m) {
    let n = 0;
    for (const p of panes.values()) {
      if (p.type === 'term' && p.name && p.ws && p.ws.readyState === 1) {
        if (sendText(p, m[1])) n++;
      }
    }
    speak(n ? `sent to ${n} agents` : 'no agents running');
    return;
  }

  m = text.match(/^(?:hey\s+)?(?:tell|ask)\s+(\w+)\s+(?:to\s+)?(.+)/i);
  if (m) {
    const p = findAgent(m[1]);
    if (p) {
      speak(sendText(p, m[2]) ? `on it, ${p.name.toLowerCase()} has it` : `${p.name.toLowerCase()} isn't running`);
      return;
    }
  }

  m = text.match(/^close\s+(\w+)/i);
  if (m) {
    const p = findAgent(m[1]);
    if (p) {
      closePane(p.id);
      speak(`${p.name.toLowerCase()} closed`);
      return;
    }
  }

  if (/^(?:new|spawn)(?:\s+an?)?\s+agent/i.test(text)) {
    document.getElementById('btn-agent').click();
    speak('pick a folder');
    return;
  }

  // "juno run the tests" — callsign as first word
  m = text.match(/^(\w+)[,:]?\s+(.+)/);
  if (m) {
    const p = findAgent(m[1]);
    if (p) {
      speak(sendText(p, m[2]) ? `${p.name.toLowerCase()} has it` : `${p.name.toLowerCase()} isn't running`);
      return;
    }
  }

  // fall through: current voice target, else any running agent
  const p = panes.get(voiceTargetId) || [...panes.values()].find((x) => x.type === 'term' && x.ws);
  if (!sendText(p, text)) speak('no agent to send that to');
}

micBtn.addEventListener('pointerdown', startListening);
micBtn.addEventListener('pointerup', stopListening);
micBtn.addEventListener('pointerleave', stopListening);

// hold F2 to talk, release to send
addEventListener('keydown', (e) => {
  if (e.key === 'F2' && !e.repeat) { e.preventDefault(); startListening(); }
});
addEventListener('keyup', (e) => {
  if (e.key === 'F2') { e.preventDefault(); stopListening(); }
});

/* ---------- conversation mode (hands-free) ----------
   Mic stays open; each finished utterance auto-sends to CLAW. Recognition is
   ignored while CLAW is speaking so it never hears itself. */

let conversationMode = false;
let convRecog = null;
const convBtn = document.getElementById('btn-conv');

function startConversation() {
  if (!SR) { alert(NO_SPEECH_MSG); return; }
  if (conversationMode) return;
  if (listening) stopListening(); // don't run both mics
  conversationMode = true;
  convBtn && convBtn.classList.add('on');
  convRecog = new SR();
  convRecog.continuous = true;
  convRecog.interimResults = true;
  convRecog.lang = 'en-US';
  convRecog.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const t = e.results[i][0].transcript.trim();
      if (t && !clawSpeaking) orchestrate(t); // echo guard
    }
  };
  convRecog.onend = () => { if (conversationMode) { try { convRecog.start(); } catch {} } };
  convRecog.onerror = () => {};
  try { convRecog.start(); } catch {}
  micBtn.classList.add('listening');
  speak('conversation mode on. talk to me.');
  clawLog('claw', 'conversation mode ON — just talk (say "stop listening" to end)');
}

function stopConversation() {
  if (!conversationMode) return;
  conversationMode = false;
  convBtn && convBtn.classList.remove('on');
  micBtn.classList.remove('listening');
  try { convRecog.stop(); } catch {}
  speak('okay, going quiet.');
  clawLog('claw', 'conversation mode off');
}

if (convBtn) convBtn.onclick = () => (conversationMode ? stopConversation() : startConversation());

/* ---------- artifact panel ----------
   Right-docked panel where CLAW shows things: a live fleet board, rich markdown
   answers, or mermaid diagrams. */

const artifactPanel = document.getElementById('artifact-panel');
const artifactBody = document.getElementById('artifact-body');
const artifactTitle = document.getElementById('artifact-title');
const artifactBtn = document.getElementById('btn-artifact');

let mermaidReady = false;
function initMermaid() {
  if (mermaidReady || !window.mermaid) return;
  try { window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' }); mermaidReady = true; } catch {}
}

/* ---------- CLAW companion (the big face panel) ---------- */
const clawPanel = document.getElementById('claw-panel');
const faceBtn = document.getElementById('btn-face');
const clawReopen = document.getElementById('claw-reopen');

function setCompanion(open) {
  if (!clawPanel) return;
  clawPanel.classList.toggle('open', open);
  if (clawReopen) clawReopen.style.display = open ? 'none' : 'flex';
  if (faceBtn) faceBtn.classList.toggle('on', open);
}
if (faceBtn) faceBtn.onclick = () => setCompanion(!clawPanel.classList.contains('open'));
if (clawReopen) clawReopen.onclick = () => setCompanion(true);

/* ---------- brain speed/depth toggle (haiku ⟷ sonnet ⟷ opus) ---------- */
const MODEL_CYCLE = ['sonnet', 'haiku', 'opus'];
const MODEL_HINT = { haiku: 'fast', sonnet: 'smart', opus: 'deep' };
let clawModel = localStorage.getItem('clawModel') || 'sonnet';
const modelBtn = document.getElementById('btn-model');

function paintModelBtn() {
  if (!modelBtn) return;
  modelBtn.textContent = `${clawModel.toUpperCase()} · ${MODEL_HINT[clawModel]}`;
}
if (modelBtn) {
  paintModelBtn();
  modelBtn.title = 'CLAW brain: sonnet (smart) · haiku (fast) · opus (deep)';
  modelBtn.onclick = () => {
    clawModel = MODEL_CYCLE[(MODEL_CYCLE.indexOf(clawModel) + 1) % MODEL_CYCLE.length];
    localStorage.setItem('clawModel', clawModel);
    paintModelBtn();
    clawLog('claw', `brain: ${clawModel} (${MODEL_HINT[clawModel]})`);
  };
}

// No Web Speech API (Firefox/Brave): make typing the obvious path, don't dead-end.
if (!SPEECH_OK) {
  micBtn.classList.add('disabled');
  micBtn.title = 'Voice needs Edge or Chrome';
  if (convBtn) { convBtn.classList.add('disabled'); convBtn.title = 'Voice needs Edge or Chrome'; }
  if (clawInput) clawInput.placeholder = 'type a command here — voice needs Edge or Chrome';
  const moodEl = document.querySelector('.cp-mood');
  const subEl = document.querySelector('.cp-sub');
  if (moodEl) moodEl.textContent = 'type below';
  if (subEl) subEl.textContent = 'voice needs Edge or Chrome';
  clawLog('claw', 'Voice is off in this browser. Type commands here, or open in Edge for voice.');
}

function openArtifacts() { if (artifactPanel) artifactPanel.classList.add('open'); }
function toggleArtifacts() { if (artifactPanel) artifactPanel.classList.toggle('open'); }
if (artifactBtn) artifactBtn.onclick = toggleArtifacts;
const artifactClose = document.getElementById('artifact-close');
if (artifactClose) artifactClose.onclick = () => artifactPanel.classList.remove('open');

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mdToHtml(md) {
  if (window.marked) { try { return window.marked.parse(md); } catch {} }
  return '<pre class="ap-raw">' + esc(md) + '</pre>';
}

async function renderArtifact(art) {
  if (!artifactPanel) return;
  const format = art.format || 'markdown';
  openArtifacts();
  let title = 'CLAW';
  let html = '';

  if (format === 'status') {
    title = 'FLEET STATUS';
    html = fleetBoardHtml();
  } else if (format === 'menu') {
    title = 'WHAT YOU CAN SAY';
    html = menuHtml();
  } else if (format === 'mermaid') {
    title = 'DIAGRAM';
    initMermaid();
    if (mermaidReady) {
      try {
        const { svg } = await window.mermaid.render('m' + (renderArtifact._n = (renderArtifact._n || 0) + 1), art.content);
        html = svg;
      } catch (e) {
        html = '<div class="ap-err">Diagram couldn\'t render.</div><pre class="ap-raw">' + esc(art.content) + '</pre>';
      }
    } else {
      html = '<pre class="ap-raw">' + esc(art.content) + '</pre>';
    }
  } else {
    title = art.title || 'CLAW';
    html = mdToHtml(art.content || '');
  }

  artifactTitle.textContent = title;
  artifactBody.innerHTML = html;
  artifactBody.scrollTop = 0;
}

// live board built straight from the panes (works even with the brain offline)
function fleetBoardHtml() {
  const agents = [...panes.values()].filter((p) => p.type === 'term' && p.name);
  if (!agents.length) return '<div class="ap-empty">No agents open. Hit + AGENT to spawn one.</div>';
  const rows = agents.map((p) => {
    let state = 'idle', label = 'idle';
    if (p.el.classList.contains('dead')) { state = 'dead'; label = 'stopped'; }
    else if (p.needsYou) { state = 'blocked'; label = 'needs you'; }
    else if (p.el.classList.contains('running')) { state = 'working'; label = 'working'; }
    return `<div class="fb-row">
      <span class="fb-dot ${state}"></span>
      <span class="fb-name">${esc(p.name)}</span>
      <span class="fb-state ${state}">${label}</span>
      <span class="fb-sub">${esc(paneSubtitle(p))}</span>
      <span class="fb-last">${esc(paneLastLine(p))}</span>
    </div>`;
  }).join('');
  return `<div class="fleet-board">${rows}</div>`;
}

function menuHtml() {
  return mdToHtml(`### Commands
- **"open an agent in dbclaw-os"** — spawn a Claude Code agent in a folder
- **"tell juno to run the tests"** — send an instruction by callsign
- **"the one doing the scraper, commit what you have"** — route by what it's *doing*
- **"everyone, git pull and summarize"** — broadcast to all agents
- **"close vega"** — shut an agent down

### Ask & understand
- **"what's everyone doing?"** / **"what's atlas stuck on?"**
- **"show me a status board"** — live fleet board
- **"draw a diagram of what the agents are doing"** — mermaid

### Do things itself
- **"open the browser"** / **"open VS Code"** / **"open YouTube"** — launch apps & sites
- **"search the web for X"** / **"what's the latest on Y"** — CLAW searches (Exa) and answers
- **"remember the soulclaw repo is https://..."** — CLAW saves it forever

### Voice
- **Hold F2** (or TALK) to speak one command
- **"conversation mode"** — hands-free; **"stop listening"** to end

### Business fleet
- **"ask arlo what's on today"**, **"ask simon about new reviews"**`);
}

/* ---------- persistence ---------- */

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}

async function save() {
  const data = {
    camera: { x: camera.x, y: camera.y, z: camera.z },
    lastCwd,
    panes: [...panes.values()].map((p) => ({
      id: p.id, type: p.type,
      x: p.x, y: p.y, w: p.w, h: p.h,
      title: p.title, name: p.name, cmd: p.cmd, cwd: p.cwd,
      content: p.type === 'note' ? p.content : '',
    })),
  };
  try {
    await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {}
}

async function load() {
  try {
    const data = await (await fetch('/api/layout')).json();
    if (data.camera) Object.assign(camera, data.camera);
    if (data.lastCwd) lastCwd = data.lastCwd;
    for (const s of data.panes || []) {
      const p = createPane(s);
      if (p.type === 'term') {
        p.el.classList.add('dead');
        showLaunchOverlay(p, 'LAUNCH');
      }
    }
    applyCamera();
  } catch {
    applyCamera();
  }
}

load();
