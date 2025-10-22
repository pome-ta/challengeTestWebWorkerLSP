// worker.js v0.7
/**
 * @file Web Worker上で動作するLSPサーバーの実装。
 * TypeScriptの仮想ファイルシステム(@typescript/vfs)を利用して、
 * メインスレッドから受け取ったコードに対して型チェックや補完機能を提供する。
 */

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const DEBUG_MODE = true; // true にすると verbose log 出力

/**
 * デバッグモードが有効な場合のみコンソールにログを出力する。
 * @param {...any} args - コンソールに出力する引数。
 */
function log(...args) {
  if (DEBUG_MODE) {
    console.log('[worker]', ...args);
  }
}

/* --- util --- */

/**
 * メインスレッドにメッセージを送信する。
 * Worker側は常にオブジェクトを送信し、メインスレッド側(Transport)で必要に応じて文字列化する。
 * オブジェクトを直接送信することで、高速で安全な構造化クローンを利用できる。
 * @param {object} obj - メインスレッドに送信するオブジェクト。
 */
function _send(obj) {
  try {
    self.postMessage(obj);
  } catch (e) {
    console.error('[worker] _send failed to postMessage', e, obj);
  }
}

/**
 * テキストとLSPのPositionオブジェクト({line, character})から、
 * テキストの先頭からのオフセット（文字数）を計算する。
 * @param {string} text - 全体のテキスト。
 * @param {{line: number, character: number}} pos - LSPのPositionオブジェクト。
 * @returns {number} 計算されたオフセット。
 */
function posToOffset(text, pos) {
  const lines = text.split('\n');
  const line = Math.max(0, Math.min(pos?.line ?? 0, lines.length - 1));
  const off = lines
    .slice(0, line)
    .reduce((acc, currentLine) => acc + currentLine.length + 1, 0);
  const character = Math.max(
    0,
    Math.min(pos?.character ?? 0, lines[line]?.length ?? 0)
  );
  return off + character;
}

/**
 * テキストとオフセットから、LSPのPositionオブジェクト({line, character})を計算する。
 * @param {string} text - 全体のテキスト。
 * @param {number} offset - テキストの先頭からのオフセット。
 * @returns {{line: number, character: number}} 計算されたPositionオブジェクト。
 */
function offsetToPos(text, offset) {
  // 不正なオフセット値を安全な範囲に丸める
  const safe = Math.max(0, Math.min(offset, text.length));
  const lines = text.slice(0, safe).split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

/**
 * TypeScriptのDisplayParts配列を単一の文字列に変換する。
 * @param {ts.SymbolDisplayPart[]} parts - TypeScriptのDisplayParts。
 * @returns {string} 結合された文字列。
 */
function displayPartsToString(parts) {
  return parts?.map((p) => p.text).join('') ?? '';
}

// --- LSPとTypeScriptの型マッピング ---

/**
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#completionItemKind
 */
const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  // ... 他にも多くの種類があります
};

/** TypeScriptの`ScriptElementKind`からLSPの`CompletionItemKind`への変換マップ */
const TS_KIND_TO_LSP_KIND_MAP = {
  method: CompletionItemKind.Method,
  function: CompletionItemKind.Function,
  constructor: CompletionItemKind.Constructor,
  field: CompletionItemKind.Field,
  variable: CompletionItemKind.Variable,
  class: CompletionItemKind.Class,
  interface: CompletionItemKind.Interface,
  module: CompletionItemKind.Module,
  property: CompletionItemKind.Property,
  unit: CompletionItemKind.Unit,
  value: CompletionItemKind.Value,
  enum: CompletionItemKind.Enum,
  keyword: CompletionItemKind.Keyword,
  snippet: CompletionItemKind.Snippet,
  text: CompletionItemKind.Text,
};

/**
 * TypeScriptの`ScriptElementKind`文字列をLSPの`CompletionItemKind`数値に変換する。
 * @param {string} tsKind - TypeScriptのkind文字列。
 * @returns {number} LSPのCompletionItemKind。
 */
function mapTsKindToLsp(tsKind) {
  return TS_KIND_TO_LSP_KIND_MAP[tsKind] ?? CompletionItemKind.Variable;
}

/* ---  LspServerCore --- */
/**
 * LSPの各機能（ドキュメント同期、補完、ホバーなど）のコアロジックを実装するクラス。
 * @class LspServerCore
 */
class LspServerCore {
  /** サーバーが提供する機能の定義 */
  static serverCapabilities = {
    textDocumentSync: 1, // 1: Full. ドキュメントの同期は常に全内容を送信する。
    completionProvider: {
      resolveProvider: true, // `completionItem/resolve` をサポート
    },
    hoverProvider: true, // `textDocument/hover` をサポート
    signatureHelpProvider: { triggerCharacters: ['(', ','] },
  };

  /** @type {Map<string, string> | null} - TypeScriptのVFS用のデフォルトファイルマップ */
  #defaultMap;
  /** @type {ts.System | null} - TypeScriptのVFSのシステムオブジェクト */
  #system;
  /** @type {vfs.VirtualTypeScriptEnvironment | null} - TypeScriptの仮想環境 */
  #env;
  /** @type {Promise<vfs.VirtualTypeScriptEnvironment> | null} - VFSの初期化処理を管理するPromise（遅延初期化用） */
  #bootPromise = null;
  /** @type {Map<string, {text: string, version?: number}>} - 開かれているファイルのURIと内容を保持するマップ */
  #openFiles = new Map();
  
  // デバッグ可能な遅延(ms)
  #_diagnosticDebounceMs = 500;
  
  // Map<uri, timeoutId>
  #_diagTimers = new Map();

  /**
   * `initialize`リクエストのハンドラ。
   * VFSを起動し、サーバーの機能と情報をクライアントに返す。
   * @returns {Promise<object>} LSPのInitializeResult。
   */
  async initialize() {
    await this.#bootVfs();
    return {
      capabilities: LspServerCore.serverCapabilities,
      serverInfo: { name: 'ts-vfs-worker', version: ts.version ?? 'unknown' },
    };
  }

  /**
   * `initialized`通知のハンドラ。クライアントの初期化完了を受け取る。
   */
  async initialized() {
    log('initialized');
  }

  /**
   * クライアントとの疎通確認用のカスタムメソッド。
   * @param {object} params - パラメータ。
   * @returns {Promise<{echoed: string}>}
   */
  async ping(params) {
    return { echoed: params?.msg ?? '(no message)' };
  }

  /**
   * `shutdown`リクエストのハンドラ。
   * リソースを解放し、シャットダウン処理を行う。
   * @returns {Promise<{success: boolean}>}
   */
  async shutdown() {
    try {
      // リソース解放処理
      this.#defaultMap?.clear?.();
      this.#system = this.#env = this.#defaultMap = null;
      this.#openFiles.clear();
    } finally {
      // 成功・失敗にかかわらず実行
      log('shutdown completed');
    }
    return { success: true };
  }

  /**
   * `exit`通知のハンドラ。
   * Workerを終了させる。
   */
  async exit() {
    log('exit received');
    self.close();
  }

  /**
   * TypeScriptの仮想ファイルシステム(VFS)を遅延初期化する。
   * @returns {Promise<vfs.VirtualTypeScriptEnvironment>} 初期化された仮想環境。
   */
  async #bootVfs() {
    // Lazy initialization パターン
    // this.#bootPromise が nullish (null or undefined) の場合のみ、
    // 右辺の即時実行非同期関数を評価・代入する
    this.#bootPromise ??= (async () => {
      // CDNからTypeScriptの型定義ファイル(.d.ts)をダウンロードしてVFSを初期化
      const defaultMap = await vfs.createDefaultMapFromCDN(
        { target: ts.ScriptTarget.ES2020 },
        ts.version,
        false,
        ts
      );
      const system = vfs.createSystem(defaultMap);
      // 仮想環境を作成
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, {
        allowJs: true,
      });
      this.#defaultMap = defaultMap;
      this.#system = system;
      this.#env = env;
      log('vfs booted (ts:', ts.version, ')');
      return env;
    })();
    return this.#bootPromise;
  }

  /**
   * `textDocument/didOpen`通知のハンドラ。
   * @param {object} params - LSPのdidOpenパラメータ。
   */
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

    this.#updateFile(path, textDocument.text);
    log('didOpen', textDocument.uri);
    
    this.#scheduleDiagnostics(textDocument.uri);
  }

  /**
   * `textDocument/didChange`通知のハンドラ。
   * @param {object} params - LSPのdidChangeパラメータ。
   */
  async 'textDocument/didChange'(params) {
    const { textDocument, contentChanges } = params ?? {};
    const uri = textDocument?.uri;
    // TextDocumentSyncKind.Full を想定し、最初の変更に完全なテキストが含まれていることを期待
    if (
      !uri ||
      !Array.isArray(contentChanges) ||
      contentChanges.length === 0 ||
      typeof contentChanges[0].text !== 'string'
    ) {
      log('didChange: invalid params', params);
      return;
    }

    const text = contentChanges[0].text;
    await this.#bootVfs();
    const path = this.#uriToPath(uri);
    this.#openFiles.set(uri, { text });

    this.#updateFile(path, text);
    this.#scheduleDiagnostics(uri);
  }

  /**
   * `textDocument/completion`リクエストのハンドラ。
   * @param {object} params - LSPのcompletionパラメータ。
   * @returns {Promise<object>} LSPのCompletionList。
   */
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
        // `completionItem/resolve`で詳細を取得するために必要な情報をdataに詰める
        data: { path, offset, name: e.name },
      }));
      return { isIncomplete: !!completions?.isIncomplete, items };
    } catch (e) {
      log('completion failed', e);
      return { isIncomplete: false, items: [] };
    }
  }

  /**
   * `completionItem/resolve`リクエストのハンドラ。補完アイテムの詳細を提供する。
   * @param {object} item - 解決対象のCompletionItem。
   * @returns {Promise<object>} 詳細情報が追加されたCompletionItem。
   */
  async 'completionItem/resolve'(item) {
    if (!item?.data) {
      return item;
    }
    await this.#bootVfs();
    const { data } = item;
    const d = this.#env.languageService.getCompletionEntryDetails(
      // `textDocument/completion`で詰めた情報を使って詳細を取得
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

  /**
   * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#diagnostic
   */
  static DiagnosticSeverity = {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4,
  };

  /**
   * `textDocument/diagnostics`リクエストのハンドラ。コードの診断情報（エラーや警告）を提供する。
   * @param {object} params - LSPのdiagnosticsパラメータ。
   * @returns {Promise<object>} LSPのFullDocumentDiagnosticReport。
   */
  async 'textDocument/diagnostics'(params) {
    const uri = params?.textDocument?.uri; // LSP 3.17
    if (!uri) {
      return { kind: 'full', items: [] }; // LSP 3.17
    }
    await this.#bootVfs();

    const doc = this.#openFiles.get(uri);
    if (!doc) {
      // ファイルが開かれていない場合は診断情報なし
      return { kind: 'full', items: [] };
    }

    const path = this.#uriToPath(uri);
    // 構文エラーと意味論エラーの両方を取得
    const all = [
      ...this.#env.languageService.getSyntacticDiagnostics(path),
      ...this.#env.languageService.getSemanticDiagnostics(path),
    ];

    const items = all.map((d) =>
      this.#tsDiagnosticToLspDiagnostic(d, doc.text)
    );
    // LSP 3.17仕様に準拠した形式で返す
    return { kind: 'full', items };
  }

  /**
   * TypeScript の QuickInfo.displayParts から
   * 型の概要のみを抽出して文字列化する簡易関数。
   * 冗長な "const", "let", "function" などを省く。
   */
  #extractTypeSummary(displayParts = []) {
    if (!Array.isArray(displayParts)) return '';
    const filtered = displayParts.filter(p => {
      // 除外対象: キーワード・空白・句読点・改行
      return !['keyword', 'punctuation', 'space'].includes(p.kind);
    });
    return filtered.map(p => p.text).join('').trim();
  }
  /**
   * `textDocument/hover` リクエストのハンドラ。
   * TypeScript の quick info を取得して LSP Hover 形式で返す。
   * @param {object} params - { textDocument: { uri }, position: { line, character } }
   * @returns {Promise<null|{contents: {kind: 'markdown'|'plaintext', value: string}, range?: {start,end}}>}
   */
  async 'textDocument/hover'(params) {
    const uri = params?.textDocument?.uri;
    const position = params?.position;
    if (!uri || !position) {
      return null; // LSP: no hover
    }

    try {
      await this.#bootVfs();
      const path = this.#uriToPath(uri);
      const doc = this.#openFiles.get(uri);
      const text = doc?.text ?? '';
      const offset = posToOffset(text, position);

      // TypeScript quick info
      const info = this.#env.languageService.getQuickInfoAtPosition(path, offset);
      if (!info) return null;

      // build markdown contents: code block of declaration + documentation
      const signature = displayPartsToString(info.displayParts);
      //const signature = this.#extractTypeSummary(info.displayParts);
      //const signature = '';
      const documentation = displayPartsToString(info.documentation);

      let value = '';
      if (signature && signature.trim().length > 0) {
        // show as typescript code block
        value += '```typescript\n' + signature + '\n```\n';
      }
      if (documentation && documentation.trim().length > 0) {
        // append documentation as markdown (already plain text from TypeScript parts)
        value += '\n' + documentation + '\n';
      }

      // compute range from info.textSpan if available
      let range;
      if (info.textSpan && typeof info.textSpan.start === 'number') {
        const startPos = offsetToPos(text, info.textSpan.start);
        const endPos = offsetToPos(text, info.textSpan.start + (info.textSpan.length ?? 0));
        range = { start: startPos, end: endPos };
      }

      return {
        contents: { kind: 'markdown', value: value || signature || documentation || '' },
        ...(range ? { range } : {}),
      };
    } catch (e) {
      log('hover failed', e);
      return null;
    }
  }

  /**
   * `textDocument/signatureHelp` リクエストのハンドラ。
   * @param {object} params - LSP の signatureHelp パラメータ。
   * @returns {Promise<object>} LSP の SignatureHelp レスポンス。
   */
  async 'textDocument/signatureHelp'(params) {
    const { textDocument, position } = params ?? {};
    const uri = textDocument?.uri;
    if (!uri || !position) {
      return { signatures: [], activeSignature: 0, activeParameter: 0 };
    }

    await this.#bootVfs();
    const path = this.#uriToPath(uri);
    const doc = this.#openFiles.get(uri);
    const offset = posToOffset(doc?.text ?? '', position);

    try {
      const help = this.#env.languageService.getSignatureHelpItems(
        path,
        offset,
        {}
      );

      if (!help || !help.items?.length) {
        return { signatures: [], activeSignature: 0, activeParameter: 0 };
      }

      const signatures = help.items.map((item) => {
        const label = `${item.prefixDisplayParts.map(p => p.text).join('')}${item.parameters
          .map(p => p.displayParts.map(dp => dp.text).join(''))
          .join(item.separatorDisplayParts.map(p => p.text).join(''))}${item.suffixDisplayParts.map(p => p.text).join('')}`;

        return {
          label,
          documentation: item.documentation?.map(d => d.text).join('') ?? '',
          parameters: item.parameters.map(p => ({
            label: p.displayParts.map(dp => dp.text).join(''),
            documentation: p.documentation?.map(d => d.text).join('') ?? ''
          })),
        };
      });

      return {
        signatures,
        activeSignature: help.selectedItemIndex ?? 0,
        activeParameter: help.argumentIndex ?? 0,
      };
    } catch (e) {
      log('signatureHelp failed', e);
      return { signatures: [], activeSignature: 0, activeParameter: 0 };
    }
  }
  
  /**
   * スケジュール: 指定URIについて診断を debounce して実行する
   * 呼び出し元: didOpen, didChange
   * @param {string} uri
   */
  #scheduleDiagnostics(uri) {
    try {
      // 既存タイマーがあればクリアして再スケジュール
      const prev = this.#_diagTimers.get(uri);
      if (prev) {
        clearTimeout(prev);
      }
  
      const timer = setTimeout(async () => {
        this.#_diagTimers.delete(uri);
        try {
          await this.#computeAndPublishDiagnostics(uri);
        } catch (e) {
          // ログのみ(診断失敗でワーカ停止させない)
          log('diagnostics failed for', uri, e);
        }
      }, this.#_diagnosticDebounceMs);
  
      this.#_diagTimers.set(uri, timer);
    } catch (e) {
      log('scheduleDiagnostics error', e);
    }
  }
  
  /**
   * 実際に TypeScript から診断を取得して publishDiagnostics 通知を送る
   * @param {string} uri
   */
  async #computeAndPublishDiagnostics(uri) {
    if (!uri) return;
  
    await this.#bootVfs();
  
    const doc = this.#openFiles.get(uri);
    const text = doc?.text ?? '';
    const path = this.#uriToPath(uri);
  
    // Collect diagnostics (syntactic + semantic)
    let all = [];
    try {
      const syntactic = this.#env.languageService.getSyntacticDiagnostics(path) || [];
      const semantic = this.#env.languageService.getSemanticDiagnostics(path) || [];
      all = [...syntactic, ...semantic];
    } catch (e) {
      log('failed to get diagnostics from TS service for', uri, e);
      all = [];
    }
  
    // Convert to LSP Diagnostic[]
    const diagnostics = all.map((d) => {
      const start = d.start ?? 0;
      const end = start + (d.length ?? 0);
      const range = {
        start: offsetToPos(text, start),
        end: offsetToPos(text, end),
      };
      return {
        range,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        severity: (d.category === ts.DiagnosticCategory.Error) ? 1 : 2, // LSP: 1 Error, 2 Warning
        code: d.code,
        source: 'typescript',
      };
    });
  
    // Send publishDiagnostics notification (no id -> notification)
    try {
      _send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri,
          diagnostics,
        },
      });
      log('published diagnostics for', uri, diagnostics.length, 'items');
    } catch (e) {
      log('failed to publish diagnostics for', uri, e);
    }
  }

  /**
   * TypeScriptのDiagnosticオブジェクトをLSPのDiagnosticオブジェクトに変換する。
   * @param {ts.Diagnostic} tsDiag - TypeScriptのDiagnosticオブジェクト。
   * @param {string} fileContent - 診断対象のファイルの内容。
   * @returns {object} LSPのDiagnosticオブジェクト。
   */
  #tsDiagnosticToLspDiagnostic(tsDiag, fileContent) {
    const start = tsDiag.start ?? 0;
    const end = start + (tsDiag.length ?? 0);
    const range = {
      start: offsetToPos(fileContent, start),
      end: offsetToPos(fileContent, end),
    };

    return {
      range,
      message: ts.flattenDiagnosticMessageText(tsDiag.messageText, '\n'),
      severity: this.#tsCategoryToLspSeverity(tsDiag.category),
      code: tsDiag.code,
      source: 'typescript',
    };
  }

  /**
   * ファイルURIからVFSで使うパスに変換する。
   * @param {string} uri - ファイルURI。
   * @returns {string} VFS用のパス。
   */
  #uriToPath(uri) {
    return uri.replace(/^file:\/\/\/?/, '');
  }

  /** VFSにファイルを作成または更新する */
  #updateFile(path, text) {
    if (this.#system.fileExists(path)) {
      this.#env.updateFile(path, text);
    } else {
      this.#env.createFile(path, text);
    }
  }

  /** TypeScriptのDiagnosticCategoryをLSPのDiagnosticSeverityに変換する */
  #tsCategoryToLspSeverity(category) {
    switch (category) {
      case ts.DiagnosticCategory.Error:
        return LspServerCore.DiagnosticSeverity.Error;
      case ts.DiagnosticCategory.Warning:
        return LspServerCore.DiagnosticSeverity.Warning;
      case ts.DiagnosticCategory.Suggestion:
        return LspServerCore.DiagnosticSeverity.Hint;
      case ts.DiagnosticCategory.Message:
        return LspServerCore.DiagnosticSeverity.Information;
      default:
        return LspServerCore.DiagnosticSeverity.Information;
    }
  }
}

/**
 * JSON-RPCのメッセージを解釈し、適切なLspServerCoreのメソッドにディスパッチするクラス。
 * Workerのエントリーポイントとして機能する。
 * @class LSPWorker
 */
const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
};

class LSPWorker {
  /** @type {LspServerCore} - LSPのコアロジックを担うインスタンス */
  #core = new LspServerCore();
  /** @type {Object<string, Function>} - RPCメソッド名とハンドラ関数のマップ */
  #handlers = {};

  /** LSPWorkerのインスタンスを生成し、ハンドラを登録する。 */
  constructor() {
    // LspServerCore の公開メソッドを動的にハンドラとして登録する
    for (const name of Object.getOwnPropertyNames(
      Object.getPrototypeOf(this.#core)
    )) {
      const fn = this.#core[name];
      // LSPのRPCメソッド(例: 'textDocument/completion')や、
      // カスタムメソッド(例: 'initialize')のみをハンドラとして登録する
      if (
        typeof fn === 'function' &&
        !name.startsWith('#') &&
        name !== 'constructor'
      ) {
        this.#handlers[name] = fn.bind(this.#core);
      }
    }
    // Workerのメッセージハンドラを設定
    self.onmessage = (event) => this.#onMessage(event);
    // 例えば LSPWorker.constructor() の最後、または VFS 初期化が完了した直後に:
    self.postMessage({ method: '__ready' });
  }

  /**
   * Workerがメッセージを受信したときに呼び出されるメインのハンドラ。
   * JSON-RPCメッセージを解析し、処理をディスパッチする。
   * @param {MessageEvent} event - onmessageイベントオブジェクト。
   */
  async #onMessage(event) {
    const rawData = event.data;
    let msg;

    try {
      // メッセージが文字列ならJSONとしてパース、オブジェクトならそのまま使用
      msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (e) {
      this.#sendErrorResponse(null, RpcErrorCode.ParseError, 'Parse error');
      return;
    }

    const { id, method, params, jsonrpc } = msg ?? {};

    // 2. リクエスト検証: JSON-RPC 2.0仕様に準拠しているか、methodが文字列か
    if (jsonrpc !== '2.0' || typeof method !== 'string') {
      // idがあれば、無効なリクエストであることをクライアントに通知
      if (id !== undefined) {
        this.#sendErrorResponse(
          id,
          RpcErrorCode.InvalidRequest,
          'Invalid Request'
        );
      }
      return;
    }

    // 3. ハンドラの検索
    const handler = this.#handlers[method];
    if (typeof handler !== 'function') {
      // idがあれば、メソッドが見つからないことをクライアントに通知
      if (id !== undefined) {
        this.#sendErrorResponse(
          id,
          RpcErrorCode.MethodNotFound,
          `Method not found: ${method}`
        );
      }
      return;
    }

    // 4. ハンドラ実行と結果の返却
    try {
      const result = await handler(params, msg); // ハンドラを実行
      // idがあればリクエストなので、結果をレスポンスとして返す
      if (id !== undefined) {
        _send({ jsonrpc: '2.0', id, result });
      }
    } catch (e) {
      // ハンドラ実行中にエラーが発生した場合
      // サーバー内部のエラー -> Internal Error
      if (id !== undefined) {
        this.#sendErrorResponse(
          id,
          RpcErrorCode.InternalError,
          e?.message ?? String(e),
          { stack: e?.stack }
        );
      }
    }
  }

  /**
   * JSON-RPCのエラーレスポンスを送信するヘルパーメソッド。
   * @param {string | number | null} id - 対応するリクエストのID。
   * @param {number} code - エラーコード。
   * @param {string} message - エラーメッセージ。
   * @param {any} [data] - エラーに関する追加情報。
   */
  #sendErrorResponse(id, code, message, data) {
    const error = { code, message };
    if (data) error.data = data;
    _send({ jsonrpc: '2.0', id, error });
  }
}

// Workerのインスタンスを作成し、メッセージの待受を開始する
new LSPWorker();

