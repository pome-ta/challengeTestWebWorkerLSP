// worker-transport.js v0.3
// - LSP Client と Web Worker の間を仲介する Transport クラス
// - createWorkerTransport(workerUrl) -> Promise<WorkerTransport>

// このクラスはモジュール内部でのみ使用し、直接エクスポートしない
class WorkerTransport {
  #worker;
  #handlers = new Set();
  #debug;

  constructor(worker, debug = false) {
    this.#worker = worker;
    this.#debug = debug;

    this.#worker.onmessage = (event) => {
      const data = event.data;

      this.#handlers.forEach(({ handler, format }) => {
        try {
          // format に応じてメッセージを変換し、ハンドラを呼び出す
          const message = format === 'json'
            ? (typeof data === 'string' ? data : JSON.stringify(data))
            : data;
          handler(message);
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
    // LSPClient が送るような JSON 文字列の場合、パースしてオブジェクトとして送信する
    // ことで、Worker 側は常に効率的な構造化クローンを利用できる。
    if (typeof message === 'string') {
      try {
        const obj = JSON.parse(message);
        this.#worker.postMessage(obj);
        if (this.#debug) console.debug('[worker-transport] sent (parsed object):', obj);
        return;
      } catch {
        // JSONではない文字列の場合はそのまま送信
      }
    }

    // オブジェクトはそのまま送信
    try {
      this.#worker.postMessage(message);
      if (this.#debug) {
        console.debug('[worker-transport] sent:', message);
      }
    } catch (e) {
      console.error('[worker-transport] postMessage failed:', e, message);
    }
  }

  subscribe(handler, options = {}) {
    const { format = 'json' } = options; // デフォルトは 'json'
    const entry = { handler, format };
    this.#handlers.add(entry);

    if (this.#debug) {
      console.debug('[worker-transport] handler subscribed:', { handler, format });
    }
  }

  unsubscribe(handler) {
    const entry = Array.from(this.#handlers).find(e => e.handler === handler);
    if (entry) this.#handlers.delete(entry);

    if (this.#debug) {
      console.debug('[worker-transport] handler unsubscribed:', handler);
    }
  }

  close() {
    this.#worker.terminate();

    if (this.#debug) {
      console.debug('[worker-transport] worker terminated');
    }
  }

  get worker() {
    return this.#worker;
  }
}

// LSPClient (@codemirror/lsp-client) 用のラッパー
// subscribe のデフォルトを 'json' 形式にする
export class LSPTransportAdapter {
  #transport;
  constructor(transport) {
    this.#transport = transport;
  }
  send = (message) => this.#transport.send(message);
  subscribe = (handler) => this.#transport.subscribe(handler, { format: 'json' });
  unsubscribe = (handler) => this.#transport.unsubscribe(handler);
  close = () => this.#transport.close();
  get worker() { return this.#transport.worker; }
}


export async function createWorkerTransport(workerUrl, debug = false) {
  const worker = new Worker(workerUrl, { type: 'module' });
  return new WorkerTransport(worker, debug);
}
