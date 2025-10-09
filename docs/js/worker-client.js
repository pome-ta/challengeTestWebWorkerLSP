// js/worker-client.js
/**
 * WorkerClient
 * - Web Worker と JSON-RPC 風のやり取りを行う最小クラス。
 * - ここでは JSON.stringify(JSON) でメッセージ送受信している(既存実装に合わせる)。
 *
 * public methods:
 *   - send(method, params)  -> Promise that resolves to the raw RPC response object
 *   - notify(method, params) -> fire-and-forget notification
 *   - terminate() -> 強制的に Worker を terminate(必要なら利用)
 *
 * 注意:
 *   - send() は JSON-RPC の "request" を送る(id を付与)。戻り値は Worker が返すレスポンスオブジェクト(そのまま)。
 *   - notify() は "notification"(id なし)で応答を待たない。
 */

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

  /**
   * JSON-RPC 風の request を送る(応答あり)
   * @param {string} method
   * @param {object} [params={}]
   * @returns {Promise<object>} - Worker が返したレスポンスオブジェクト({jsonrpc,id,result} など)
   */
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

  /**
   * JSON-RPC 風の notification(応答なし:fire-and-forget)
   * @param {string} method
   * @param {object} [params={}]
   */
  notify(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params }; // id なし
    this.#worker.postMessage(JSON.stringify(msg));
  }

  /**
   * Worker を即時終了させる(ブラウザ API)
   * - 通常 LSP 仕様に従うなら Worker 側で exit を受け self.close() するため不要だが、
   *   必要に応じて呼べるように残してある。
   */
  terminate() {
    this.#worker.terminate();
    console.log('[WorkerClient] Worker terminated.');
  }

  /**
   * Worker からの onmessage を受け取り、内部で dispatch する
   *  - __workerLog を受け取ったら main 側の console に転送
   *  - id があれば pending を解決する
   */
  #onMessage(event) {
    // 我々は Worker から JSON 文字列を受け取る前提で実装している(以前の実装に合わせる)
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

