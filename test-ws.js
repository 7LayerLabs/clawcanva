// smoke test: spawn a pty over the websocket bridge and echo something back
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:18790/term');
let out = '';
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'spawn', cmd: 'echo CLAWCANVAS_PTY_OK', cwd: 'C:\\Users\\Derek', cols: 80, rows: 24 }));
});
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type === 'data') out += msg.data;
  if (msg.type === 'exit') {
    console.log(out.includes('CLAWCANVAS_PTY_OK') ? 'PTY BRIDGE OK' : 'FAIL:\n' + out);
    process.exit(0);
  }
});
setTimeout(() => { console.log('TIMEOUT:\n' + out); process.exit(1); }, 15000);
