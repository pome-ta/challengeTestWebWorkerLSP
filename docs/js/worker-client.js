// worker-client.js
// Worker(JSON-RPC風) とやり取りする簡易クライアントラッパー。
// - createWorkerClient(workerUrl, options) を呼ぶと Promise で準備済みインスタンスを返す
// - インスタンスは .transport (LSPClient に渡す Transport) を持ち、
//   initialize/initialized/shutdown/exit/ping 等の便利メソッドを提供する
//
// 前提: createWorkerTransport(workerUrl, debug) が存在し、Transport は
// { send(message:StringOrObject), subscribe(handler(String)), unsubscribe(handler), worker } を満たすこと
//
// 注意点:
// - メッセージは JSON 文字列で送受信される前提で実装(transport が受信を文字列で渡す設計)
// - 内部で request/response を待つ pending マップを持つ
// - タイムアウトはデフォルト 10000ms(オプションで変更可)
// - main 側で LSPClient を使うには returned.transport を使って connect する

import { createWorkerTransport } from './worker-transport.js';

/**
 * WorkerClient - 内部クラス
 * @private
 */
class WorkerClientImpl {
  #transport;          // transport オブジェクト (worker-transport が提供)
  #seq = 1;            // request id カウンタ
  #pending = new Map();// id -> {resolve, reject, timeoutId}
  #debug = false;
  #messageHandler = null;

  /**
   * @param {{transport: any, debug?: boolean}} opts
   */
  constructor({ transport, debug = false }) {
    this.#transport = transport;
    this.#debug = !!debug;
    this.#messageHandler = this.#onMessage.bind(this);
    this.#transport.subscribe(this.#messageHandler);
    if (this.#debug) {
      console.debug('[WorkerClient] attached to transport', this.#transport);
    }
  }

  /**
   * 内部: transport からのメッセージ受信処理
   * transport は文字列(JSON)を渡してくる想定
   * @param {string} raw
   */
  #onMessage(raw) {
    if (this.#debug) console.debug('[WorkerClient] onmessage raw:', raw);
    let msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      console.warn('[WorkerClient] failed to parse worker message:', raw);
      return;
    }

    // JSON-RPC 応答パターン: id があり result または error を含む
    if (msg && ('id' in msg)) {
      const pend = this.#pending.get(msg.id);
      if (!pend) {
        if (this.#debug) console.warn('[WorkerClient] unknown response id:', msg.id, msg);
        return;
      }
      // タイムアウトクリア
      if (pend.timeoutId) clearTimeout(pend.timeoutId);
      this.#pending.delete(msg.id);

      if ('error' in msg && msg.error) {
        pend.reject(msg.error);
      } else {
        pend.resolve(msg.result);
      }
      return;
    }

    // 通知など(id なし)-- 今は特別な処理はしない。デバッグログのみ。
    if (this.#debug) console.debug('[WorkerClient] unhandled message (notification?):', msg);
  }

  /**
   * send - JSON-RPC request を送って result のみを Promise で返す
   * @param {string} method
   * @param {any} params
   * @param {{ timeoutMs?: number }} opts
   * @returns {Promise<any>} result または reject(error)
   */
  send(method, params = {}, opts = {}) {
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 10000;
    const id = this.#seq++;

    const msg = { jsonrpc: '2.0', id, method, params };
    const raw = JSON.stringify(msg);

    return new Promise((resolve, reject) => {
      // タイムアウト設定
      const timeoutId = timeoutMs > 0 ? setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject({ code: -32000, message: `timeout (${timeoutMs}ms)` });
        }
      }, timeoutMs) : null;

      this.#pending.set(id, { resolve, reject, timeoutId });

      try {
        // transport.send は文字列 (JSON) を期待する設計
        this.#transport.send(raw);
        if (this.#debug) console.debug('[WorkerClient] sent', raw);
      } catch (e) {
        if (timeoutId) clearTimeout(timeoutId);
        this.#pending.delete(id);
        reject({ code: -32000, message: 'postMessage failed: ' + String(e) });
      }
    });
  }

  /**
   * notify - JSON-RPC notification (id なし)
   * @param {string} method
   * @param {any} params
   */
  notify(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params };
    try {
      this.#transport.send(JSON.stringify(msg));
      if (this.#debug) console.debug('[WorkerClient] notify sent', msg);
    } catch (e) {
      console.warn('[WorkerClient] notify failed', e);
    }
  }

  /**
   * close - クライアントをクローズ (transport unsubscribe + close)
   */
  close() {
    try {
      this.#transport.unsubscribe(this.#messageHandler);
    } catch (e) {
      if (this.#debug) console.warn('[WorkerClient] unsubscribe failed', e);
    }
    try {
      if (typeof this.#transport.close === 'function') this.#transport.close();
    } catch (e) {
      if (this.#debug) console.warn('[WorkerClient] transport close failed', e);
    }
  }
}

/**
 * createWorkerClient - ファクトリ関数
 * - 内部で createWorkerTransport を呼び transport を得る
 * - WorkerClient インスタンスを返す
 *
 * @param {string} workerUrl - Worker スクリプトの URL/相対パス
 * @param {{ debug?: boolean }} options
 * @returns {Promise<{ client: WorkerClientImpl, transport: any,
 *   initialize: (p)=>Promise, initialized:(p)=>void, shutdown:()=>Promise, exit:()=>void, ping:(p)=>Promise }>}
 */
export async function createWorkerClient(workerUrl, options = {}) {
  const { debug = false } = options;
  // createWorkerTransport は worker-transport.js 側で定義されている想定
  const transport = await createWorkerTransport(workerUrl, debug);

  const client = new WorkerClientImpl({ transport, debug });

  // ラッパー: LSP の常用メソッド
  const wrapper = {
    client,
    transport,
    /**
     * initialize request (awaitable)
     * @param {object} params
     */
    initialize: (params = {}) => client.send('initialize', params),
    /**
     * initialized notification (no-wait)
     * @param {object} params
     */
    initialized: (params = {}) => client.notify('initialized', params),
    /**
     * shutdown request (awaitable)
     */
    shutdown: (params = {}) => client.send('shutdown', params),
    /**
     * exit notification (no-wait)
     */
    exit: (params = {}) => client.notify('exit', params),
    /**
     * ping (request)
     */
    ping: (params = {}) => client.send('ping', params),
    /**
     * close - internal cleanup. 呼び出すと transport を閉じる
     */
    close: () => client.close(),
  };

  if (debug) console.debug('[createWorkerClient] ready', { workerUrl, transport });

  return wrapper;
}
