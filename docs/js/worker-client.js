// worker-client.js
export class WorkerClient {
  #worker;
  #nextId = 1;
  #pending = new Map();

  /**
   * @param {string} workerPath - Web Worker スクリプトのパス
   */
  constructor(workerPath) {
    this.#worker = new Worker(workerPath, { type: 'module' });
    this.#worker.onmessage = this.#onMessage.bind(this);
  }

  /**
   * JSON-RPC リクエスト(応答あり)
   * @param {string} method
   * @param {object} [params={}]
   * @returns {Promise<object>}
   */
  send(method, params = {}) {
    const id = this.#nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#worker.postMessage(JSON.stringify(msg));
    });
  }
  /**
   * JSON-RPC 通知(応答なし)
   * @param {string} method
   * @param {object} [params={}]
   */
  notify(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params }; // id なし
    this.#worker.postMessage(JSON.stringify(msg));
  }


  /**
   * Worker からのメッセージ受信処理
   */
  #onMessage(event) {
    const msg = JSON.parse(event.data);

    // Worker 側 console.log の転送処理
    if (msg.__workerLog) {
      console.log(...msg.args);
      return;
    }

    // RPC レスポンス処理
    if (msg.id && this.#pending.has(msg.id)) {
      this.#pending.get(msg.id)(msg);
      this.#pending.delete(msg.id);
      return;
    }

    console.warn('[WorkerClient] Unhandled message:', msg);
  }
}

/**
 * WorkerClient インスタンスを生成し、
 * LSP の便利メソッドをまとめたオブジェクトを返す。
 * (将来は worker-rpc.js に分離予定)
 */
export function createWorkerRpc(workerPath) {
  const client = new WorkerClient(workerPath);

  return {
    client,
    initialize: (params) => client.send('initialize', params),
    initialized: (params) => client.notify('initialized', params), // ← notifyに変更
    shutdown: () => client.send('shutdown'),
  };
}

