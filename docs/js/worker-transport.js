// worker-transport.js
// - LSP Client と Web Worker の間を仲介する Transport クラス
// - createWorkerTransport(workerUrl) -> Promise<WorkerTransport>

export class WorkerTransport {
  #worker;
  #handlers = new Set();
  #debug;

  constructor(worker, debug = false) {
    this.#worker = worker;
    this.#debug = debug;

    this.#worker.onmessage = (event) => {
      const data = event.data;
      const json = typeof data === 'string' ? data : JSON.stringify(data);

      
      this.#handlers.forEach((handler) => {
        try {
          handler(json);
        } catch (err) {
          console.error('[worker-transport] handler error:', err);
        }
      });
      
      
    };

    this.#worker.onmessageerror = (err) => {
      console.error('[worker-transport] message error:', err);
    };

    this.#worker.onerror = (err) => {
      console.error('[worker-transport] worker error:', err);
    };
  }

  send(message) {
    // 現在の CodeMirror LSPClient は JSON 文字列を送るので stringify 不要
    this.#worker.postMessage(message);

    if (this.#debug) {
      console.debug('[worker-transport] sent:', message);
    }
  }

  subscribe(handler) {
    this.#handlers.add(handler);

    if (this.#debug) {
      console.debug('[worker-transport] handler subscribed:', handler);
    }
  };

  return {
    // LSPClient 側は "message string" を渡す（多くは JSON 文字列）
    send(message) {
      // message が文字列ならそのまま、オブジェクトなら構造化クローンで渡す
      console.log(`send: ${message}`);
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

export async function createWorkerTransport(workerUrl, debug = false) {
  const worker = new Worker(workerUrl, { type: 'module' });
  return new WorkerTransport(worker, debug);
}

