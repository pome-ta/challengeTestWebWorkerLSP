// js/worker-client.js
/**
 * WorkerClient - JSON-RPC(2.0) 風に Worker とやり取りする軽量クライアント
 *
 * 特徴:
 *  - メッセージは文字列(JSON)で送受信する前提
 *  - send() は Promise を返し、成功時に result のみを返す
 *  - send() はタイムアウトをサポート(デフォルト 10000ms)
 *  - notify() は通知(id無し)を送る
 *  - 受信メッセージに __workerLog がある場合はコンソール出力の代理
 *
 * 使い方:
 *   import { createWorkerRpc, WorkerClient } from './js/worker-client.js';
 *   const rpc = createWorkerRpc('./js/worker.js');
 *   await rpc.initialize({...});
 *   rpc.client.notify('textDocument/didOpen', {...});
 */

export class WorkerClient {
  #worker;
  #nextId = 1;
  #pending = new Map();
  #debug = false;

  /**
   * @param {string} workerPath - Worker スクリプトのパス
   * @param {{debug?: boolean}} options
   */
  constructor(workerPath, options = {}) {
    this.#debug = !!options.debug;
    console.log(`WorkerClient.debug: ${this.#debug}`);
    this.#worker = new Worker(workerPath, { type: 'module' });
    this.#worker.onmessage = this.#onMessage.bind(this);
  }

  /**
   * send - JSON-RPC request (id付き)
   * @param {string} method
   * @param {object} params
   * @param {{timeoutMs?: number}} opts
   * @returns {Promise<any>} resolved with result or rejected with {code,message,data?}
   */
  send(method, params = {}, opts = {}) {
    const timeoutMs =
      typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 10000; // default 10s
    const id = this.#nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    const raw = JSON.stringify(msg);

    return new Promise((resolve, reject) => {
      // タイムアウト管理
      const timeoutId =
        timeoutMs > 0
          ? setTimeout(() => {
              if (this.#pending.has(id)) {
                this.#pending.delete(id);
                reject({ code: -32000, message: `timeout (${timeoutMs}ms)` });
              }
            }, timeoutMs)
          : null;

      this.#pending.set(id, { resolve, reject, timeoutId });
      try {
        this.#worker.postMessage(raw);
        if (this.#debug) {
          console.debug('[WorkerClient] sent', raw);
        }
      } catch (e) {
        if (timeoutId) clearTimeout(timeoutId);
        this.#pending.delete(id);
        reject({ code: -32000, message: 'postMessage failed: ' + String(e) });
      }
    });
  }

  /**
   * notify - JSON-RPC notification (id無し)
   * @param {string} method
   * @param {object} params
   */
  notify(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params };
    try {
      this.#worker.postMessage(JSON.stringify(msg));
      if (this.#debug) console.debug('[WorkerClient] notify', msg);
    } catch (e) {
      console.warn('[WorkerClient] notify postMessage failed', e);
    }
  }

  /**
   * terminate - worker を即時終了(必要時のみ呼ぶこと)
   */
  terminate() {
    try {
      this.#worker.terminate();
      if (this.#debug) console.debug('[WorkerClient] terminated worker');
    } catch (e) {
      console.warn('[WorkerClient] terminate failed', e);
    }
  }

  /**
   * 内部: Worker からの onmessage ハンドラ
   * event.data は文字列(JSON)で来る前提(worker 側が JSON.stringify していること)
   */
  #onMessage(event) {
    const raw = event.data;
    if (this.#debug) {
      console.debug('[WorkerClient] onmessage typeof', typeof raw, raw);
    }

    let msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      console.warn('[WorkerClient] failed to parse worker message:', raw);
      return;
    }

    // worker の console proxy
    if (msg && msg.__workerLog) {
      // level があれば使う
      const args = Array.isArray(msg.args) ? msg.args : [msg.args];
      const level = msg.level || 'log';
      console[level?.in?.(console) ? level : 'log']('[worker]', ...args);
      return;
    }

    // RPC 応答 (id がある)
    if (msg && 'id' in msg) {
      const pending = this.#pending.get(msg.id);
      if (!pending) {
        console.warn('[WorkerClient] Unknown response id:', msg.id, msg);
        return;
      }
      this.#pending.delete(msg.id);
      if (pending.timeoutId) clearTimeout(pending.timeoutId);

      if ('error' in msg && msg.error) {
        pending.reject(msg.error);
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // その他(notification など)
    // ここでは汎用的には扱わない。必要ならイベント発火機構を追加する。
    if (this.#debug)
      console.debug('[WorkerClient] Unhandled worker message:', msg);
  }
}

/**
 * createWorkerRpc - WorkerClient を作り LSP 風のラッパーを返す
 * @param {string} workerPath
 * @param {{debug?: boolean}} options
 */
export function createWorkerRpc(workerPath, options = {}) {
  const client = new WorkerClient(workerPath, options);
  return {
    client,
    initialize: (params) => client.send('initialize', params),
    initialized: (params) => client.notify('initialized', params),
    shutdown: (params) => client.send('shutdown', params),
    exit: (params) => client.notify('exit', params),
    ping: (params) => client.send('ping', params),
    send: client.send.bind(client),
    notify: client.notify.bind(client),
  };
}
