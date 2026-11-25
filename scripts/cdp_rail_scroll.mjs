// Scroll the viewer rail and count every distinct asset id the page reveals.
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const TARGET_URL = process.argv[2];
const ROUNDS = Number(process.argv[3] || 12);

const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const netIds = new Set();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params?.request?.url || '';
    const m = url.match(/generated\/([0-9a-f-]{36})\//);
    if (m) netIds.add(m[1]);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: TARGET_URL });
await new Promise((r) => setTimeout(r, 8000));

const evalJs = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return res.result?.value;
};

// Find the scrollable rail (vertical strip with overflowing children).
await evalJs(`(() => {
  const all = [...document.querySelectorAll('div')];
  const rail = all.find(el => el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 300 && el.clientWidth < 260);
  if (rail) { window.__rail = rail; return true; }
  return false;
})()`);

for (let i = 0; i < ROUNDS; i++) {
  await evalJs(`(() => { const r = window.__rail; if (!r) return; r.scrollBy(0, r.clientHeight * 0.9); })()`);
  await new Promise((r) => setTimeout(r, 1400));
}

const domIds = await evalJs(`(() => {
  const ids = new Set();
  document.querySelectorAll('img').forEach(i => { const m = (i.src||'').match(/generated\\/([0-9a-f-]{36})/); if (m) ids.add(m[1]); });
  document.querySelectorAll('*').forEach(el => { const bg = getComputedStyle(el).backgroundImage; if (bg) { const m = bg.match(/generated\\/([0-9a-f-]{36})/); if (m) ids.add(m[1]); } });
  return ids.size;
})()`);
console.log('network ids:', netIds.size, '| dom ids after scroll:', domIds);
ws.close();
