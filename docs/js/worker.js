import { setupConsoleRedirect } from './worker-utils.js';

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';


setupConsoleRedirect();
console.log('[worker] console redirected OK');

// -----------------------------
// LspServerCore: LSPロジック担当
// -----------------------------
class LspServerCore {
  #fsMap;
  #system;
  #env;

  constructor() {
    this.#fsMap = null;
    this.#system = null;
    this.#env = null;
  }

  async initialize() {
    await this.#bootVfs();
    return {
      capabilities: {
        completionProvider: { resolveProvider: true },
      },
    };
  }

  async ping(params) {
    return { echoed: params?.msg ?? '(no message)' };
  }
  
  async shutdown() {
    this.#fsMap?.clear();
    this.#system = null;
    this.#env = null;
    console.log('[worker] shutdown completed.');
    return { success: true };
  }

  async #bootVfs() {
    if (this.#fsMap) {
      return;
    }

    const fsMap = new Map();
    const env = await vfs.createDefaultMapFromCDN(
      { target: ts.ScriptTarget.ES2020 },
      ts.version,
      false,
      ts
    );

    env.forEach((v, k) => fsMap.set(k, v));
    this.#system = vfs.createSystem(fsMap);
    this.#fsMap = fsMap;
    this.#env = env;

    console.log(`[worker] vfs boot completed. TypeScript version: ${ts.version}`);
  }
}

// -----------------------------
// LSPWorker: JSON-RPC ループ担当
// -----------------------------
class LSPWorker {
  #core;
  #handlers;

  constructor() {
    this.#core = new LspServerCore();

    // メソッド名とハンドラの対応表
    this.#handlers = {
      initialize: this.#core.initialize.bind(this.#core),
      shutdown: this.#core.shutdown.bind(this.#core),
      ping: this.#core.ping.bind(this.#core),
    };

    self.onmessage = (event) => this.#handleMessage(event);
  }

  async #handleMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      console.log('[worker raw]', event.data);
      return;
    }

    if (msg.id) {
      await this.#handleRequest(msg);
    } else {
      this.#handleNotify(msg);
    }
  }

  async #handleRequest(msg) {
    const { id, method } = msg;
    const handler = this.#handlers[method];
    if (handler) {
      try {
        const result = await handler(msg.params || {});
        this.#respond(id, result);
      } catch (e) {
        this.#respondError(id, { code: -32000, message: String(e) });
      }
    } else {
      this.#respondError(id, { code: -32601, message: `Method not found: ${method}` });
    }
  }

  #handleNotify(msg) {
    console.log('[worker notify]', msg.method, msg.params ?? '(no params)');
  }

  #respond(id, result) {
    self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  #respondError(id, error) {
    self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, error }));
  }
}

// -----------------------------
// 実行開始
// -----------------------------
new LSPWorker();
