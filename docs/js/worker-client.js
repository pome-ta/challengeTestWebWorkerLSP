// worker-client.js v0.2
// Worker(JSON-RPC風) とやり取りする簡易クライアントラッパー。

import { createWorkerTransport, LSPTransportAdapter } from './worker-transport.js';

const CLIENT_ID_PREFIX = 'wc:';

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
    // 生のオブジェクトを受け取るように指定
    this.#transport.subscribe(this.#messageHandler, { format: 'raw' });
    if (this.#debug)
      console.debug('[WorkerClient] attached to transport', this.#transport);
  }

  #onMessage(raw) {
    if (this.#debug) console.debug('[WorkerClient] onmessage:', raw);
    if (!raw || typeof raw !== 'object') {
      if (this.#debug) console.debug('[WorkerClient] received invalid message (not an object)');
      return;
    }

    // Handle a response to a request sent by this client
    if ('id' in raw && typeof raw.id === 'string' && raw.id.startsWith(CLIENT_ID_PREFIX)) {
      const pend = this.#pending.get(raw.id);
      if (!pend) {
        if (this.#debug) console.warn('[WorkerClient] response for unknown own id:', raw.id, raw);
        return;
      }

      if (pend.timeoutId) clearTimeout(pend.timeoutId);
      this.#pending.delete(raw.id);

      if ('error' in raw && raw.error) {
        pend.reject(raw.error);
      } else {
        pend.resolve(raw.result);
      }
    // Handle a notification from the worker (currently ignored)
    } else if ('method' in raw) {
      if (this.#debug) console.debug('[WorkerClient] notification received (ignored):', raw.method, raw.params ?? null);
    // Handle a response for another client (e.g., LSPClient)
    } else if ('id' in raw) {
      if (this.#debug) console.debug('[WorkerClient] ignoring response for external id:', raw.id);
    } else {
      if (this.#debug) console.debug('[WorkerClient] received unknown message shape:', raw);
    }
  }

  send(method, params = {}, opts = {}) {
    const timeoutMs =
      typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 10000;
    const msg = { jsonrpc: '2.0', id: `${CLIENT_ID_PREFIX}${this.#seq++}`, method, params };

    return new Promise((resolve, reject) => {
      const timeoutId =
        timeoutMs > 0
          ? setTimeout(() => {
              this.#pending.delete(msg.id);
              reject({ code: -32000, message: `Request '${method}' timed out (${timeoutMs}ms)` });
            }, timeoutMs)
          : null;

      this.#pending.set(msg.id, { resolve, reject, timeoutId });

      try {
        this.#transport.send(msg);
        if (this.#debug) console.debug('[WorkerClient] sent', msg);
      } catch (e) {
        if (timeoutId) clearTimeout(timeoutId);
        this.#pending.delete(msg.id);
        reject({ code: -32000, message: 'send failed: ' + String(e) });
      }
    });
  }

  notify(method, params) {
    const msg = { jsonrpc: '2.0', method, params };
    try {
      this.#transport.send(msg);
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
    // 保留中のすべてのリクエストを reject してリソースリークを防ぐ
    for (const [id, pend] of this.#pending.entries()) {
      if (pend.timeoutId) clearTimeout(pend.timeoutId);
      // エラーコード -32001 は独自定義: Client is closing
      pend.reject({ code: -32001, message: 'WorkerClient is closing.' });
    }
    this.#pending.clear();

    try {
      this.#transport.unsubscribe(this.#messageHandler);
      this.#transport.close?.();
    } catch (e) {
      if (this.#debug) console.warn('[WorkerClient] close failed:', e);
    }
  }

  get transport() {
    return new LSPTransportAdapter(this.#transport);
  }
}

export async function createWorkerClient(workerUrl, options = {}) {
  const { debug = false } = options;
  const transport = await createWorkerTransport(workerUrl, debug);
  const client = new WorkerClientImpl({ transport, debug });

  if (debug) console.debug('[createWorkerClient] initialized');
  return client;
}
