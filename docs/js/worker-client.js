// worker-client.js v0.1.1
// Worker(JSON-RPC風) とやり取りする簡易クライアントラッパー。

import { createWorkerTransport } from './worker-transport.js';

class WorkerClientImpl {
  #transport;
  #seq = 1;
  #pending = new Map(); // id -> {resolve, reject, timeoutId}
  #debug = false;
  #messageHandler = null;

  constructor({ transport, debug = false }) {
    this.#transport = transport;
    this.#debug = !!debug;
    this.#messageHandler = this.#onMessage.bind(this);
    this.#transport.subscribe(this.#messageHandler);
    if (this.#debug) console.debug('[WorkerClient] attached to transport', this.#transport);
  }

  /**
   * Worker からのメッセージを受信
   * - JSON-RPC 応答(idあり)
   * - 通知(idなし)
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

    // --- JSON-RPC 応答(idあり)---
    if (msg && 'id' in msg) {
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

    // --- 通知(idなし)---
    if (this.#debug) console.debug('[WorkerClient] unhandled message (notification?):', msg);
  }

  /**
   * send - JSON-RPC request を送信し、Promiseで result を返す
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
      // --- タイムアウト設定 ---
      const timeoutId = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`WorkerClient timeout: ${method}`));
      }, timeoutMs);

      // --- 保留中リクエストに登録 ---
      this.#pending.set(id, { resolve, reject, timeoutId });

      // --- 実送信 ---
      try {
        this.#transport.send(raw);
      } catch (e) {
        clearTimeout(timeoutId);
        this.#pending.delete(id);
        reject(e);
      }
    });
  }

  notify(method, params) {
    const msg = { jsonrpc: '2.0', method, params };
    try {
      this.#transport.send(JSON.stringify(msg));
    } catch (e) {
      if (this.#debug) console.warn('[WorkerClient] notify send failed:', e);
    }
  }

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

export async function createWorkerClient(workerUrl, options = {}) {
  const { debug = false } = options;
  const transport = await createWorkerTransport(workerUrl, debug);
  const client = new WorkerClientImpl({ transport, debug });

  if (debug) console.debug('[createWorkerClient] initialized');
  return client;
}
