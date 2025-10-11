// worker-transport.js
export async function createWorkerTransport(workerUrl) {
  const worker = new Worker(workerUrl, { type: 'module' });
  const handlers = new Set();

  worker.onmessage = (e) => {
    let data = e.data;
    // Worker 側が JSON 文字列を送る前提（あなたの実装に合致）
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch {}
    }
    for (const h of handlers) h(data);
  };

  // LSPClient 側に返す Transport 互換オブジェクト
  return {
    send(message) {
      // codemirror/lsp-client は JSON 文字列を送るのでそのまま渡す
      worker.postMessage(typeof message === 'string' ? message : JSON.stringify(message));
    },
    subscribe(handler) {
      handlers.add(handler);
    },
    unsubscribe(handler) {
      handlers.delete(handler);
    },
    worker, // 明示的に Worker インスタンスも expose（任意）
  };
}
