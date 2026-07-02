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

/* ---------- panes ---------- */

let spawnCascade = 0;

function nextSpawnPos(w, h) {
  const c = screenToWorld(innerWidth / 2, innerHeight / 2);
  spawnCascade = (spawnCascade + 1) % 8;
  return { x: c.x - w / 2 + spawnCascade * 34, y: c.y - h / 2 + spawnCascade * 34 };
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
      <span class="pane-title"></span>
      <span class="head-spacer"></span>
      ${p.type === 'term' ? '<button class="head-btn btn-target" title="Set as voice target">◉</button>' : ''}
      <button class="head-btn btn-close" title="Close">✕</button>
    </div>
    <div class="pane-body"></div>
    <div class="grip"></div>`;
  el.querySelector('.pane-title').textContent = p.title;
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
    if (msg.type === 'data') term.write(msg.data);
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
};

document.getElementById('btn-note').onclick = () => {
  const pos = nextSpawnPos(320, 260);
  createPane({ type: 'note', title: 'NOTE', ...pos });
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
  const p = createPane({ type: 'term', title: `${name} · ${folder.toUpperCase()}`, name, cmd, cwd, ...pos });
  launchTerm(p);
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
let recog = null;
let listening = false;
let voiceDiscard = false;

function startListening() {
  if (!SR) {
    alert('This browser has no Web Speech API (Firefox/Brave don\'t). Run start-clawcanvas.cmd — it opens ClawCanvas in Edge, where voice works.');
    return;
  }
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

function refreshVoices() {
  const all = speechSynthesis.getVoices();
  voiceList = all.filter((v) => /Online \(Natural\)/i.test(v.name) && v.lang.startsWith('en'));
  if (!voiceList.length) voiceList = all.filter((v) => v.lang.startsWith('en'));
  const saved = localStorage.getItem('clawVoice');
  clawVoice =
    voiceList.find((v) => v.name === saved) ||
    voiceList.find((v) => /Andrew/i.test(v.name)) ||
    voiceList.find((v) => /Guy/i.test(v.name)) ||
    voiceList[0] || null;
}
speechSynthesis.onvoiceschanged = refreshVoices;
refreshVoices();

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (clawVoice) u.voice = clawVoice;
    u.rate = 1.08;
    speechSynthesis.speak(u);
  } catch {}
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
  focusPane(p.id);
  return true;
}

/* ---------- CLAW brain ----------
   Every transcript goes to the server, which asks Claude (haiku) to turn it
   into actions: spawn / send / close / say. Regex router below is the
   offline fallback. */

const clawLogEl = document.getElementById('claw-log');
const clawInput = document.getElementById('claw-input');
const clawDot = document.querySelector('.cp-dot');

function clawLog(who, text) {
  const div = document.createElement('div');
  div.className = 'cp-line ' + who;
  div.textContent = (who === 'you' ? '› ' : '⚡ ') + text;
  clawLogEl.appendChild(div);
  clawLogEl.scrollTop = clawLogEl.scrollHeight;
}

async function orchestrate(text) {
  clawLog('you', text);
  clawDot.classList.add('thinking');
  try {
    const body = {
      transcript: text,
      lastCwd,
      agents: [...panes.values()]
        .filter((p) => p.type === 'term' && p.name)
        .map((p) => ({ name: p.name, cwd: p.cwd, running: !!(p.ws && p.ws.readyState === 1) })),
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
      }
    }
    if (data.say) { speak(data.say); clawLog('claw', data.say); }
  } catch (e) {
    clawLog('claw', 'brain offline — using direct routing');
    handleVoice(text);
  } finally {
    clawDot.classList.remove('thinking');
  }
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
