// worker.js v0.1
// Minimal LSP Worker (TypeScript + @typescript/vfs)
// ESM module
// 現段階では console 転送を main に送らない(パフォーマンス優先)

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const DEBUG_MODE = true; // true にすると verbose log 出力

function log(...args) {
  if (DEBUG_MODE) {
    console.log('[worker]', ...args);
  }
}

/* --- util --- */

/**
 * _send(obj)
 * - main 側が文字列を期待するケースがあるため Transport 側で調整する。
 * - Worker 側はオブジェクト(構造化クローン)で送ることに統一する(高速で安全)。
 */
function _send(obj) {
  try {
    // オブジェクトをそのまま postMessage する(structured clone)
    self.postMessage(obj);
  } catch (e) {
    // stringify fallback はやめる:受け側で対応する方が安全(双方向の一貫性を保つため)
    console.error('[worker] _send failed to postMessage', e, obj);
  }
}

function posToOffset(text, pos) {
  const lines = text.split('\n');
  const line = Math.min(pos.line ?? 0, lines.length - 1);
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i].length + 1;
  off += Math.min(pos.character ?? 0, lines[line].length);
  return off;
}

function offsetToPos(text, offset) {
  const safe = Math.max(0, Math.min(offset, text.length));
  const lines = text.slice(0, safe).split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function displayPartsToString(parts) {
  return parts?.map((p) => p.text).join('') ?? '';
}

function mapTsKindToLsp(tsKind) {
  const map = {
    method: 2,
    function: 3,
    constructor: 4,
    field: 5,
    variable: 6,
    class: 7,
    interface: 8,
    module: 9,
    property: 10,
    unit: 11,
    value: 12,
    enum: 13,
    keyword: 14,
    snippet: 15,
    text: 1,
  };
  return map[tsKind?.toLowerCase?.()] ?? 6;
}

/* ---  LspServerCore --- */
class LspServerCore {
  #defaultMap;
  #system;
  #env;
  #bootPromise;
  #openFiles = new Map();

  async initialize() {
    await this.#bootVfs();
    return {
      capabilities: {
        textDocumentSync: 1,
        completionProvider: { resolveProvider: true },
      },
      serverInfo: { name: 'ts-vfs-worker', version: ts.version ?? 'unknown' },
    };
  }

  async initialized() {
    log('initialized');
  }

  async ping(params) {
    return { echoed: params?.msg ?? '(no message)' };
  }

  async shutdown() {
    try {
      this.#defaultMap?.clear?.();
    } catch {}
    this.#system = this.#env = this.#defaultMap = null;
    this.#openFiles.clear();
    log('shutdown completed');
    return { success: true };
  }

  async exit() {
    log('exit received');
    self.close();
  }

  async #bootVfs() {
    if (this.#env) {
      return;
    }
    if (this.#bootPromise) {
      return this.#bootPromise;
    }
    this.#bootPromise = (async () => {
      const defaultMap = await vfs.createDefaultMapFromCDN(
        { target: ts.ScriptTarget.ES2020 },
        ts.version,
        false,
        ts
      );
      const system = vfs.createSystem(defaultMap);
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, {
        allowJs: true,
      });
      this.#defaultMap = defaultMap;
      this.#system = system;
      this.#env = env;
      log('vfs booted (ts:', ts.version, ')');
      return env;
    })();
    try {
      return await this.#bootPromise;
    } finally {
      this.#bootPromise = null;
    }
  }

  async 'textDocument/didOpen'(params) {
    const td = params?.textDocument;
    if (!td?.uri || typeof td.text !== 'string') return;
    await this.#bootVfs();
    const path = this.#uriToPath(td.uri);
    this.#openFiles.set(td.uri, { text: td.text, version: td.version ?? 1 });
    try {
      this.#env.createFile(path, td.text);
    } catch {
      this.#env.updateFile(path, td.text);
    }
    log('didOpen', td.uri);
  }

  async 'textDocument/didChange'(params) {
    const uri = params?.textDocument?.uri;
    const text = params?.contentChanges?.[0]?.text ?? params?.text;
    if (!uri || typeof text !== 'string') {
      return;
    }
    await this.#bootVfs();
    const path = this.#uriToPath(uri);
    this.#openFiles.set(uri, { text });
    try {
      this.#env.updateFile(path, text);
    } catch {
      this.#env.createFile(path, text);
    }
  }

  async 'textDocument/completion'(params) {
    const uri = params?.textDocument?.uri;
    if (!uri) {
      return { isIncomplete: false, items: [] };
    }
    await this.#bootVfs();
    const path = this.#uriToPath(uri);
    const doc = this.#openFiles.get(uri);
    const offset = posToOffset(
      doc?.text ?? '',
      params?.position ?? { line: 0, character: 0 }
    );
    try {
      const completions = this.#env.languageService.getCompletionsAtPosition(
        path,
        offset,
        {}
      );
      const items = (completions?.entries ?? []).map((e) => ({
        label: e.name,
        kind: mapTsKindToLsp(e.kind),
        data: { path, offset, name: e.name },
      }));
      return { isIncomplete: !!completions?.isIncomplete, items };
    } catch (e) {
      log('completion failed', e);
      return { isIncomplete: false, items: [] };
    }
  }

  async 'completionItem/resolve'(item) {
    const data = item?.data;
    if (!data) {
      return item;
    }
    await this.#bootVfs();
    const d = this.#env.languageService.getCompletionEntryDetails(
      data.path,
      data.offset,
      data.name,
      undefined,
      undefined
    );
    return Object.assign({}, item, {
      detail: displayPartsToString(d?.displayParts),
      documentation: displayPartsToString(d?.documentation),
      insertText: d?.insertText ?? item.label,
      kind: mapTsKindToLsp(d?.kind ?? item.kind),
    });
  }

  async 'textDocument/diagnostics'(params) {
    const uri = params?.textDocument?.uri;
    if (!uri) {
      return [];
    }
    await this.#bootVfs();
    const path = this.#uriToPath(uri);
    const content = this.#openFiles.get(uri)?.text ?? '';
    const all = [
      ...this.#env.languageService.getSyntacticDiagnostics(path),
      ...this.#env.languageService.getSemanticDiagnostics(path),
    ];
    return all.map((d) => {
      const r1 = offsetToPos(content, d.start ?? 0);
      const r2 = offsetToPos(content, (d.start ?? 0) + (d.length ?? 0));
      const msg =
        typeof d.messageText === 'string'
          ? d.messageText
          : JSON.stringify(d.messageText);
      return {
        range: { start: r1, end: r2 },
        message: msg,
        severity:
          d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        code: d.code,
      };
    });
  }

  #uriToPath(uri) {
    return uri.replace(/^file:\/\/\/?/, '');
  }
}

/* --- JSON-RPC Worker --- */

class LSPWorker {
  #core = new LspServerCore();
  #handlers = {};

  constructor() {
    // LspServerCore のメソッドを自動登録(private 除外)
    for (const name of Object.getOwnPropertyNames(
      Object.getPrototypeOf(this.#core)
    )) {
      if (name.startsWith('#')) {
        continue;
      }
      const fn = this.#core[name];
      if (typeof fn === 'function') {
        this.#handlers[name] = fn.bind(this.#core);
      }
    }
    self.onmessage = (event) => this.#onMessage(event);
  }

  async #onMessage(event) {
    let msg;
    try {
      msg =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return _send({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
      });
    }

    const { id, method, params } = msg;
    if (!method) {
      return;
    }

    const handler = this.#handlers[method];
    if (!handler) {
      if (id !== undefined) {
        _send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      } else {
        log('unknown notify', method);
      }
      return;
    }

    try {
      const result = await handler(params);
      if (id !== undefined) {
        _send({ jsonrpc: '2.0', id, result });
      }
    } catch (e) {
      const err = { code: -32000, message: e?.message ?? String(e) };
      if (id !== undefined) {
        _send({ jsonrpc: '2.0', id, error: err });
      }
    }
  }
}

new LSPWorker();

