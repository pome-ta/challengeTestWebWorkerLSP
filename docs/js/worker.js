// worker.js
import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

/** 
 * Worker 側の console.log をメインスレッドへ送信するラッパー
 * これで eruda からも Worker 内ログを確認できる
 */
function log(...args) {
  self.postMessage(JSON.stringify({
    jsonrpc: '2.0',
    method: 'log',
    params: args.map(String),
  }));
}

class LSPWorker {
  constructor() {
    self.onmessage = (ev) => this.handleMessage(ev);
    this.fsMap = null;
    this.system = null;
    this.env = null;
  }

  async handleMessage(ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      this.handleRequest(msg);
    } else {
      this.handleNotify(msg);
    }
  }

  async handleRequest(msg) {
    const { id, method } = msg;
    if (method === 'initialize') {
      try {
        await this.bootVfs();
        this.respond(id, {
          capabilities: {
            completionProvider: { resolveProvider: true },
          },
        });
      } catch (e) {
        this.respondError(id, { code: -32000, message: String(e) });
      }
    } else {
      this.respondError(id, { code: -32601, message: 'Method not found' });
    }
  }

  handleNotify(msg) {
    log('[worker notify]', msg.method, msg.params);
  }

  async bootVfs() {
    if (this.fsMap) return;
    const fsMap = new Map();
    const system = vfs.createSystem(fsMap);
    const env = await vfs.createDefaultMapFromCDN(
      { target: ts.ScriptTarget.ES2020 },
      ts.version,
      false,
      ts
    );
    for (const [k, v] of env) fsMap.set(k, v);
    this.fsMap = fsMap;
    this.system = system;
    this.env = env;
    log('[worker] vfs boot completed. TypeScript version:', ts.version);
  }

  respond(id, result) {
    self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  respondError(id, error) {
    self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, error }));
  }
}

new LSPWorker();

