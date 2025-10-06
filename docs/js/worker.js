import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

class LSPWorker {
  #fsMap;
  #system;
  #env;
  #handlers;

  constructor() {
    self.onmessage = (event) => this.handleMessage(event);

    this.#handlers = {
      initialize: this.handleInitialize.bind(this),
      ping: this.handlePing.bind(this),
    };
  }

  async handleMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      console.log('[worker raw]', event.data);
      return;
    }

    if (msg.id) {
      await this.handleRequest(msg);
    } else {
      this.handleNotify(msg);
    }
  }

  async handleRequest(msg) {
    const {id, method} = msg;
    const handler = this.#handlers[method];
    if (handler) {
      try {
        const result = await handler(msg.params || {});
        this.#respond(id, result);
      } catch (e) {
        this.#respondError(id, {code: -32000, message: String(e)});
      }
    } else {
      this.#respondError(id, {code: -32601, message: `Method not found: ${method}`});
    }
  }

  handleNotify(msg) {
    console.log('[worker notify]', msg.method, msg.params ?? '(no params)');
  }

  // --- メソッドハンドラ ---
  async handleInitialize() {
    await this.#bootVfs();
    return {
      capabilities: {
        completionProvider: {resolveProvider: true},
      },
    };
  }

  async handlePing(params) {
    return {echoed: params?.msg ?? '(no message)'};
  }

  // --- 内部メソッド ---
  async #bootVfs() {
    if (this.#fsMap) return;

    const fsMap = new Map();
    const env = await vfs.createDefaultMapFromCDN(
      {target: ts.ScriptTarget.ES2020},
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

  #respond(id, result) {
    self.postMessage(JSON.stringify({jsonrpc: '2.0', id, result}));
  }

  #respondError(id, error) {
    self.postMessage(JSON.stringify({jsonrpc: '2.0', id, error}));
  }
}


function setupConsoleRedirect() {
  const origLog = console.log;
  console.log = (...args) => {
    try {
      self.postMessage(JSON.stringify({__workerLog: true, args}));
    } catch {
      origLog(...args);
    }
  };
}

setupConsoleRedirect();
console.log('[worker] console redirected OK');

new LSPWorker();

