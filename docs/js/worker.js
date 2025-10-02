// worker.js
// JSON-RPC っぽい受け取り方をする Worker 側実装

self.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.id) {
    // リクエスト
    handleRequest(msg);
  } else {
    // 通知
    handleNotify(msg);
  }
};

function handleRequest(msg) {
  if (msg.method === 'ping') {
    respond(msg.id, { echoed: msg.params.msg });
  } else {
    respondError(msg.id, { code: -32601, message: 'Method not found' });
  }
}

function handleNotify(msg) {
  if (msg.method === 'textDocument/didOpen') {
    console.log('[worker] didOpen:', msg.params.uri);
  } else {
    console.log('[worker] notify:', msg);
  }
}

function respond(id, result) {
  self.postMessage(JSON.stringify({
    jsonrpc: '2.0',
    id,
    result
  }));
}

function respondError(id, error) {
  self.postMessage(JSON.stringify({
    jsonrpc: '2.0',
    id,
    error
  }));
}

