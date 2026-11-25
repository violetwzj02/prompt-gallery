// Capture which XHR/fetch returns the sibling image list, using CDP directly.
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const TARGET_URL = process.argv[2] || 'https://grok.com/imagine';

const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const bodies = [];

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

ws.addEventListener('message', async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Network.responseReceived') {
    const { requestId, response, type } = msg.params;
    if (!['Fetch', 'XHR', 'Document'].includes(type)) return;
    if (!/grok\.com/.test(response.url)) return;
    bodies.push({ requestId, url: response.url, type, status: response.status });
  }
});

await new Promise((resolve) => ws.addEventListener('open', resolve));
await send('Network.enable', { maxTotalBufferSize: 200000000, maxResourceBufferSize: 80000000 });
await send('Page.enable');
await send('Page.navigate', { url: TARGET_URL });
await new Promise((r) => setTimeout(r, 9000));

const hits = [];
for (const item of bodies) {
  try {
    const { body, base64Encoded } = await send('Network.getResponseBody', { requestId: item.requestId });
    const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
    const generated = (text.match(/\/generated\//g) || []).length;
    const assets = (text.match(/assets\.grok\.com/g) || []).length;
    if (generated > 1 || assets > 1) hits.push({ url: item.url, type: item.type, len: text.length, generated, assets });
  } catch (e) {}
}
hits.sort((a, b) => b.generated + b.assets - (a.generated + a.assets));
console.log('candidates:', hits.length);
for (const h of hits.slice(0, 10)) console.log(h.generated, h.assets, h.len, h.url);
ws.close();
