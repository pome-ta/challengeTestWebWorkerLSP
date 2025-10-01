const worker = new Worker('./js/worker.js', { type: 'module' });

//console.log(worker)
//console.log(self)



// リクエスト管理用
let nextId = 1;
const pending = new Map();

// Worker からのメッセージを受け取る
worker.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  console.log(msg)
  if (msg.method === "log") {
    console.log(msg.params); // => [worker] didOpen: file:///main.ts
    return;
  }
  // 通常の JSON-RPC 応答処理 ...
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(msg.error);
    else resolve(msg.result);
  } else {
    console.log('[notify from worker]', msg);
  }
};

// JSON-RPC リクエスト送信
function rpcRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    }));
  });
}

// JSON-RPC 通知送信
function rpcNotify(method, params) {
  console.log('rpcNotify');
  worker.postMessage(JSON.stringify({
    jsonrpc: '2.0',
    method,
    params
  }));
}

// 実行例
(async () => {
  console.log('--- main start ---');

  // 通知(返答なし)
  rpcNotify('textDocument/didOpen', { uri: 'file:///main.ts' });

  // リクエスト(返答あり)
  const res = await rpcRequest('ping', { msg: 'hello from main' });
  console.log('ping result:', res);

  console.log('--- done ---');
})();
