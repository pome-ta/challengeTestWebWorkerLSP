// js/worker-client.js

export class WorkerClient {
  #worker;
  #nextId = 1;
  #pending = new Map();

  /**
   * @param {string} workerPath - Worker スクリプトのパス(相対パスや URL)
   */
  constructor(workerPath) {
    this.#worker = new Worker(workerPath, { type: 'module' });
    this.#worker.onmessage = this.#onMessage.bind(this);
  }


  send(method, params = {}) {
    const id = this.#nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.#pending.set(id, (response) => {
        if ('error' in response) {
          reject(response.error);
        } else {
          resolve(response.result);
        }
      });
      this.#worker.postMessage(JSON.stringify(msg));
    });
  }

  
  notify(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params }; // id なし
    this.#worker.postMessage(JSON.stringify(msg));
  }


  terminate() {
    this.#worker.terminate();
    console.log('[WorkerClient] Worker terminated.');
  }

  
  #onMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.warn('[WorkerClient] failed to parse message from worker:', event.data);
      return;
    }

    if (msg && msg.__workerLog) {
      // Worker の console ログ転送
      console.log('[worker]', ...msg.args);
      return;
    }

    if (msg && msg.id && this.#pending.has(msg.id)) {
      this.#pending.get(msg.id)(msg);
      this.#pending.delete(msg.id);
      return;
    }

    console.warn('[WorkerClient] Unhandled message:', msg);
  }
}

/**
 * createWorkerRpc
 * - WorkerClient の簡易ラッパー。よく使う LSP 的メソッドを名前付きで返す。
 * - これにより main 側は createWorkerRpc(...).initialize(...) のように使える。
 */
export function createWorkerRpc(workerPath) {
  const client = new WorkerClient(workerPath);

  return {
    client,
    initialize: (params) => client.send('initialize', params),
    initialized: (params) => client.notify('initialized', params), // notify(idなし)
    shutdown: () => client.send('shutdown'),
    exit: () => client.notify('exit'), // notify(Worker 側で self.close() を呼ぶ)
    ping: (params) => client.send('ping', params),
  };
}

