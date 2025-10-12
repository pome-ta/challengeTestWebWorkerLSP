// worker-transport.js
// - createWorkerTransport(workerUrl) -> Promise<Transport>
// - Transport: { send(message), subscribe(handler), unsubscribe(handler), worker }

// handler は "文字列"（JSON）で呼ばれることを期待します（codemirror/lsp-client の実装に合わせる）
export async function createWorkerTransport(workerUrl) {
  const worker = new Worker(workerUrl, { type: 'module' });
  const handlers = new Set();

  // Worker -> Main の受け取り
  worker.onmessage = (ev) => {
    const data = ev.data;
    // data が文字列ならそのまま。オブジェクトなら JSON.stringify して文字列に変換。
    const json = typeof data === 'string' ? data : JSON.stringify(data);

    // subscribe されたハンドラ全てに文字列を渡す（LSPClient が JSON.parse することを想定）
    for (const h of handlers) {
      try {
        h(json);
      } catch (e) {
        console.error('worker-transport handler error', e);
      }
    }
  };

  return {
    // LSPClient 側は "message string" を渡す（多くは JSON 文字列）
    send(message) {
      // message が文字列ならそのまま、オブジェクトなら構造化クローンで渡す
      if (typeof message === 'string') {
        worker.postMessage(message);
      } else {
        // 多くの LSPClient 実装は文字列を send するが、念のためオブジェクトを取る場合にも対応
        worker.postMessage(message);
      }
    },
    subscribe(handler) {
      handlers.add(handler);
    },
    unsubscribe(handler) {
      handlers.delete(handler);
    },
    // Worker インスタンスを直接必要とする場合に備えて保持
    worker,
  };
}
