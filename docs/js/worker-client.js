// worker-client.js v0.2
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
      if (this.#debug) console.warn('[WorkerClient] failed to parse worker message:', raw);
      return;
    }
  
    // JSON-RPC: message with id -> only care about our own namespaced ids (strings starting with 'wc:')
    if (msg && ('id' in msg)) {
      const id = msg.id;
      // we only handle responses for ids we issued (our ids are strings like 'wc:1')
      if (typeof id === 'string' && id.startsWith('wc:')) {
        const pend = this.#pending.get(id);
        if (!pend) {
          // Unexpected: our id but no pending entry. Log at debug level.
          if (this.#debug) console.warn('[WorkerClient] response for unknown own id:', id, msg);
          return;
        }
        // clear timeout and resolve/reject
        if (pend.timeoutId) clearTimeout(pend.timeoutId);
        this.#pending.delete(id);
        if ('error' in msg && msg.error) pend.reject(msg.error);
        else pend.resolve(msg.result);
        return;
      }
      // Not our id — this is another client (e.g. codemirror's LSPClient). Ignore silently.
      if (this.#debug) {
        console.debug('[WorkerClient] ignoring response for external id:', msg.id);
      }
      return;
    }
  
    // Notifications or other messages (no id)
    if (msg && msg.method) {
      // Optionally handle notifications you care about here (e.g. server-initiated)
      if (this.#debug) {
        console.debug('[WorkerClient] notification received (ignored):', msg.method, msg.params ?? null);
      }
    } else {
      if (this.#debug) console.debug('[WorkerClient] received unknown message shape:', msg);
    }
  }

  /**
   * send - JSON-RPC request を送信し、Promiseで result を返す
   * @param {string} method
   * @param {any} params
   * @param {{ timeoutMs?: number }} opts
   * @returns {Promise<any>}
   */
  send(method, params = {}, opts = {}) {
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 10000;
  
    // Use string id with namespace to avoid colliding with other JSON-RPC clients that use numeric ids.
    const id = `wc:${this.#seq++}`;
  
    const msg = { jsonrpc: '2.0', id, method, params };
    const raw = JSON.stringify(msg);
  
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = timeoutMs > 0 ? setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject({ code: -32000, message: `timeout (${timeoutMs}ms)` });
        }
      }, timeoutMs) : null;
  
      // Store pending
      this.#pending.set(id, { resolve, reject, timeoutId });
  
      // Send via transport. Transport expects a string (lsp-client convention), but is robust.
      try {
        this.#transport.send(raw);
        if (this.#debug) console.debug('[WorkerClient] sent', { id, method, params });
      } catch (e) {
        if (timeoutId) clearTimeout(timeoutId);
        this.#pending.delete(id);
        reject({ code: -32000, message: 'send failed: ' + String(e) });
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
