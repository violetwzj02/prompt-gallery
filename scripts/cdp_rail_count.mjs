// Ground truth: which /generated/ asset ids does the post page actually load?
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const TARGET_URL = process.argv[2];
const WAIT = Number(process.argv[3] || 12000);

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
const seen = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Network.responseReceived' || msg.method === 'Network.requestWillBeSent') {
    const url = msg.params?.response?.url || msg.params?.request?.url || '';
    const m = url.match(/generated\/([0-9a-f-]{36})\//);
    if (m) seen.set(m[1], url);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: TARGET_URL });
await new Promise((r) => setTimeout(r, WAIT));
const res = await send('Runtime.evaluate', {
  expression: `(() => {
    const urls = new Set();
    document.querySelectorAll('img').forEach(i => i.src && urls.add(i.src));
    document.querySelectorAll('*').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg.includes('/generated/')) urls.add(bg);
    });
    const ids = new Set();
    for (const u of urls) { const m = u.match(/generated\\/([0-9a-f-]{36})/); if (m) ids.add(m[1]); }
    return { dom: ids.size, scrollH: document.documentElement.scrollHeight };
  })()`,
  returnByValue: true,
});
console.log('network ids:', seen.size, '| dom ids:', res.result?.value?.dom);
console.log('sample:', [...seen.keys()].slice(0, 6).join(', '));
ws.close();
