// worker.js v0.3
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
  const line = Math.max(0, Math.min(pos?.line ?? 0, lines.length - 1));
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i].length + 1;
  const character = Math.max(
    0,
    Math.min(pos?.character ?? 0, lines[line]?.length ?? 0)
  );
  return off + character;
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
  // より宣言的で読みやすい switch 文を使用
  switch (tsKind) {
    case 'method': return 2;
    case 'function': return 3;
    case 'constructor': return 4;
    case 'field': return 5;
    case 'variable': return 6;
    case 'class': return 7;
    case 'interface': return 8;
    case 'module': return 9;
    case 'property': return 10;
    case 'unit': return 11;
    case 'value': return 12;
    case 'enum': return 13;
    case 'keyword': return 14;
    case 'snippet': return 15;
    case 'text': return 1;
    default: return 6; // Default to Variable
  }
}

/* ---  LspServerCore --- */
class LspServerCore {
  static serverCapabilities = {
    textDocumentSync: 1, // Full sync
    completionProvider: {
      resolveProvider: true, // `completionItem/resolve` をサポート
    },
    hoverProvider: true, // `textDocument/hover` をサポート
  };

  #defaultMap;
  #system;
  #env;
  // VFSの初期化を遅延させるためのPromise
  #bootPromise = null;
  #openFiles = new Map();

  async initialize() {
    await this.#bootVfs();
    return {
      capabilities: LspServerCore.serverCapabilities,
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
    // Lazy initialization パターン
    if (this.#bootPromise) return this.#bootPromise;

    return this.#bootPromise = (async () => {
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
  }

  async 'textDocument/didOpen'(params) {
    const { textDocument } = params ?? {};
    if (!textDocument?.uri || typeof textDocument.text !== 'string') {
      log('didOpen: invalid params', params);
      return;
    }

    await this.#bootVfs();
    const path = this.#uriToPath(textDocument.uri);
    this.#openFiles.set(textDocument.uri, {
      text: textDocument.text,
      version: textDocument.version ?? 1,
    });

    // ファイルが存在すれば更新、なければ作成
    if (this.#system.fileExists(path)) {
      this.#env.updateFile(path, textDocument.text);
    } else {
      this.#env.createFile(path, textDocument.text);
    }
    log('didOpen', textDocument.uri);
  }

  async 'textDocument/didChange'(params) {
    const { textDocument, contentChanges } = params ?? {};
    const uri = textDocument?.uri;
    // LSPでは通常contentChangesが使われる
    const text = contentChanges?.[0]?.text;

    if (!uri || typeof text !== 'string') {
      log('didChange: invalid params', params);
      return;
    }

    await this.#bootVfs();
    const path = this.#uriToPath(uri);
    this.#openFiles.set(uri, { text });

    // ファイルが存在すれば更新、なければ作成
    if (this.#system.fileExists(path)) {
      this.#env.updateFile(path, text);
    } else {
      this.#env.createFile(path, text);
    }
  }

  async 'textDocument/completion'(params) {
    const { textDocument, position } = params ?? {};
    const uri = textDocument?.uri;
    if (!uri || !position) {
      return { isIncomplete: false, items: [] };
    }
    await this.#bootVfs();
    const path = this.#uriToPath(uri);
    const doc = this.#openFiles.get(uri);
    const offset = posToOffset(doc?.text ?? '', position);
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
    if (!item?.data) {
      return item;
    }
    await this.#bootVfs();
    const { data } = item;
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
    const uri = params?.textDocument?.uri; // LSP 3.17
    if (!uri) {
      // 古いクライアントは textDocument/didChange の後に要求してくることがある
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
      // ネストされたDiagnosticMessageChainにも対応
      const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      return {
        range: { start: r1, end: r2 },
        message: msg,
        severity: d.category === ts.DiagnosticCategory.Error ? 1 : 2, // 1: Error, 2: Warning
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
    const rawData = event.data;
    let msg;

    // 1. パース処理: 不正なJSONはここで弾く
    try {
      msg =
        typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (e) {
      // JSONとしてパースできない -> Parse Error (-32700)
      _send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    const { id, method, params } = msg ?? {};

    // 2. リクエスト検証: methodプロパティの存在と型をチェック
    if (typeof method !== 'string') {
      // 有効なリクエストではない -> Invalid Request (-32600)
      if (id !== undefined) {
        _send({
          jsonrpc: '2.0',
          id,
          error: { code: -32600, message: 'Invalid Request: "method" is missing or not a string.' },
        });
      }
      return;
    }

    // 3. ハンドラの検索と実行
    const handler = this.#handlers[method];
    if (!handler) {
      // メソッドが見つからない -> Method Not Found (-32601)
      if (id !== undefined) {
        _send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
      return;
    }

    // 4. ハンドラ実行と結果の返却
    try {
      const result = await handler(params);
      // idがあればリクエスト、なければ通知(notification)
      if (id !== undefined) {
        _send({ jsonrpc: '2.0', id, result });
      }
    } catch (e) {
      // サーバー内部のエラー -> Server Error (-32000 ~ -32099)
      const err = { code: -32000, message: e?.message ?? String(e), data: { stack: e?.stack } };
      if (id !== undefined) {
        _send({ jsonrpc: '2.0', id, error: err });
      }
    }
  }
}

new LSPWorker();
