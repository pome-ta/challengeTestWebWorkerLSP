// worker-client.js v0.2
// Worker(JSON-RPC風) とやり取りする簡易クライアントラッパー。

import { createWorkerTransport } from './worker-transport.js';

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
    this.#transport.subscribe(this.#messageHandler);
    if (this.#debug)
      console.debug('[WorkerClient] attached to transport', this.#transport);
  }

  #onMessage(raw) {
    if (this.#debug) console.debug('[WorkerClient] onmessage raw:', raw);
    let msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      if (this.#debug)
        console.warn('[WorkerClient] failed to parse worker message:', raw);
      return;
    }
    if (!msg) {
      if (this.#debug) console.debug('[WorkerClient] received empty message');
      return;
    }

    // Handle responses
    if ('id' in msg) {
      const { id } = msg;
      if (typeof id !== 'string' || !id.startsWith(CLIENT_ID_PREFIX)) {
        if (this.#debug)
          console.debug(
            '[WorkerClient] ignoring response for external id:',
            id
          );
        return;
      }
      const pend = this.#pending.get(id);
      if (!pend) {
        if (this.#debug)
          console.warn('[WorkerClient] response for unknown own id:', id, msg);
        return;
      }
      if (pend.timeoutId) clearTimeout(pend.timeoutId);
      this.#pending.delete(id);
      if ('error' in msg && msg.error) {
        pend.reject(msg.error);
      } else {
        pend.resolve(msg.result);
      }
      // Handle notifications from worker (currently ignored)
    } else if (msg.method) {
      if (this.#debug)
        console.debug(
          '[WorkerClient] notification received (ignored):',
          msg.method,
          msg.params ?? null
        );
    } else {
      if (this.#debug)
        console.debug('[WorkerClient] received unknown message shape:', msg);
    }
  }

  send(method, params = {}, opts = {}) {
    const timeoutMs =
      typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 10000;
    const id = `${CLIENT_ID_PREFIX}${this.#seq++}`;
    const msg = { jsonrpc: '2.0', id, method, params };
    const raw = JSON.stringify(msg);

    return new Promise((resolve, reject) => {
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
        this.#transport.send(raw);
        if (this.#debug)
          console.debug('[WorkerClient] sent', { id, method, params });
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
      // Reject all pending promises
      for (const [id, pend] of this.#pending.entries()) {
        if (pend.timeoutId) clearTimeout(pend.timeoutId);
        pend.reject({ code: -32001, message: 'WorkerClient closed' });
      }
      this.#pending.clear();

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

export function createWorkerClient(workerUrl, options = {}) {
  const { debug = false } = options;
  const transport = createWorkerTransport(workerUrl, debug);
  const client = new WorkerClientImpl({ transport, debug });

  if (debug) console.debug('[createWorkerClient] initialized');
  return client;
}
