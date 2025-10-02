// ts-worker.js (module Worker)

// console.log を main に転送する
function sendLog(...args) {
  self.postMessage(JSON.stringify({
    method: 'log',
    params: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  }));
}
console.log = (...args) => sendLog(...args);

// JSON-RPC 応答 helper
function sendResult(id, result) {
  self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
}
function sendError(id, error) {
  self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, error }));
}

// JSON-RPC dispatcher
async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'ping') {
    sendResult(id, { echoed: params.text });
    return;
  }

  if (method === 'textDocument/didOpen') {
    const uri = params?.textDocument?.uri;
    console.log('[worker] didOpen:', uri);
    return;
  }

  sendError(id, { code: -32601, message: 'Method not found: ' + method });
}

self.onmessage = (ev) => {
  let obj;
  try { obj = JSON.parse(ev.data); } catch (e) {
    sendError(null, { code: -32700, message: 'Parse error' });
    return;
  }
  handleMessage(obj).catch(err => {
    sendError(obj.id ?? null, { code: -32000, message: String(err) });
  });
};
