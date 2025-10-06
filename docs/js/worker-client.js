export default class WorkerClient {
  #worker;
  #nextId = 1;
  #pending = new Map();

  constructor(workerPath) {
    this.#worker = new Worker(workerPath, { type: 'module' });
    this.#worker.onmessage = this.#onMessage.bind(this);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#worker.postMessage(JSON.stringify(msg));
    });
  }

  #onMessage(event) {
    const msg = JSON.parse(event.data);

    if (msg.__workerLog) {
      // Worker 内の console.log を main 側へ
      console.log('[worker]', ...msg.args);
      return;
    }

    if (msg.id && this.#pending.has(msg.id)) {
      this.#pending.get(msg.id)(msg);
      this.#pending.delete(msg.id);
    } else {
      console.log('[worker raw]', msg);
    }
  }
}
