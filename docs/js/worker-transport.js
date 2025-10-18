// worker-transport.js v0.2
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
  }

  unsubscribe(handler) {
    this.#handlers.delete(handler);

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

export async function createWorkerTransport(workerUrl, debug = false) {
  const worker = new Worker(workerUrl, { type: 'module' });
  return new WorkerTransport(worker, debug);
}
