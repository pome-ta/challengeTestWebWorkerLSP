// main.js (ESM)

console.log('--- main start ---');

const worker = new Worker('./js/worker.js', { type: 'module' });

// Worker からのメッセージを受け取る
worker.onmessage = (ev) => {
  let msg = ev.data;
  try { msg = JSON.parse(msg); } catch {}

  // Worker 側ログ転送
  if (msg.method === 'log') {
    console.log(msg.params); // eruda にも表示される
    return;
  }

  // JSON-RPC 応答
  if (msg.jsonrpc === '2.0') {
    if (msg.result !== undefined) {
      console.log('RPC result:', msg.result);
    } else if (msg.error) {
      console.error('RPC error:', msg.error);
    }
    return;
  }

  console.log('Other message:', msg);
};

// JSON-RPC リクエスト送信 helper
let nextId = 1;
function rpcRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const listener = (ev) => {
      let msg = ev.data;
      try { msg = JSON.parse(msg); } catch {}
      if (msg.jsonrpc === '2.0' && msg.id === id) {
        worker.removeEventListener('message', listener);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    worker.addEventListener('message', listener);
    worker.postMessage(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

// didOpen → ping
(async () => {
  await rpcRequest('textDocument/didOpen', {
    textDocument: { uri: 'file:///main.ts', languageId: 'typescript', version: 1, text: 'const a = 1;' }
  });

  const res = await rpcRequest('ping', { text: 'hello from main' });
  console.log('ping result:', res);

  console.log('--- done ---');
})();
