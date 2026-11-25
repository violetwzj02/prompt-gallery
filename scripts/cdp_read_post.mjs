// Open a post page, wait, then report the resolved URL and the rail image ids.
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const TARGET_URL = process.argv[2];
const WAIT = Number(process.argv[3] || 8000);

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
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: TARGET_URL });
await new Promise((r) => setTimeout(r, WAIT));

const evalJs = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return res.result?.value;
};

const href = await evalJs('location.href');
const ids = await evalJs(`(() => {
  const urls = new Set();
  for (const img of document.querySelectorAll('img')) if (img.src) urls.add(img.src);
  for (const el of document.querySelectorAll('[style*="background-image"]')) {
    const m = getComputedStyle(el).backgroundImage.match(/url\\("?([^")]+)"?\\)/);
    if (m) urls.add(m[1]);
  }
  return [...urls].filter(u => u.includes('/generated/')).map(u => (u.match(/generated\\/([0-9a-f-]{36})/) || [])[1]).filter(Boolean);
})()`);
console.log('href:', href);
console.log('rail ids:', (ids || []).length, JSON.stringify((ids || []).slice(0, 12)));
ws.close();
