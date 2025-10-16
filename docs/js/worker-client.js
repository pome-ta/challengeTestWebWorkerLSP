// worker-client.js v0.1
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
   * @returns {Promise<any>}
   */
  send(method, params, opts = {}) {
    const id = this.#seq++;
    const msg = { jsonrpc: '2.0', id, method, params };
    const raw = JSON.stringify(msg);
    const timeoutMs = opts.timeoutMs ?? 10000;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`WorkerClient timeout: ${method}`));
      }, timeoutMs);

      this.#pending.set(id, { resolve, reject, timeoutId });
      try {
        this.#transport.send(raw);
      } catch (e) {
        clearTimeout(timeoutId);
        this.#pending.delete(id);
        reject(e);
      }
    });
  }

  /**
   * notify - JSON-RPC 通知(応答なし)
   * @param {string} method
   * @param {any} params
   */
  notify(method, params) {
    const msg = { jsonrpc: '2.0', method, params };
    try {
      this.#transport.send(JSON.stringify(msg));
    } catch (e) {
      if (this.#debug) console.warn('[WorkerClient] notify send failed:', e);
    }
  }

  /**
   * 基本的な LSP Lifecycle メソッド群
   */
  async initialize(params = {}) {
    return await this.send('initialize', params);
  }

  initialized() {
    this.notify('initialized', {});
  }

  async shutdown() {
    return await this.send('shutdown', {});
  }

  exit() {
    this.notify('exit', {});
  }

  async ping(msg = 'ping') {
    return await this.send('ping', { msg });
  }

  /**
   * Transport を閉じる
   */
  close() {
    try {
      this.#transport.unsubscribe(this.#messageHandler);
      this.#transport.close?.();
    } catch (e) {
      if (this.#debug) console.warn('[WorkerClient] close failed:', e);
    }
  }

  get transport() {
    return this.#transport;
  }
}

/**
 * createWorkerClient(workerUrl, options)
 * @param {string} workerUrl
 * @param {{ debug?: boolean }} options
 * @returns {Promise<WorkerClientImpl>}
 */
export async function createWorkerClient(workerUrl, options = {}) {
  const { debug = false } = options;
  const transport = await createWorkerTransport(workerUrl, debug);
  const client = new WorkerClientImpl({ transport, debug });

  // Worker 側初期化シーケンス
  await client.initialize({ processId: 1, rootUri: 'file:///' });
  client.initialized();

  if (debug) console.debug('[createWorkerClient] initialized');
  return client;
}
