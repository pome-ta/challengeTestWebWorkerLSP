// --- lsp-server-core.js v0.9

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

/**
 * メインスレッドにメッセージを送信する。
 * @param {object} obj - メインスレッドに送信するオブジェクト。
 */
function _send(obj) {
  try {
    self.postMessage(obj);
  } catch (e) {
    console.error(
      '[worker | lsp-server-core] _send failed to postMessage',
      e,
      obj
    );
  }
}

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
};

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


function mapTsKindToLsp(tsKind) {
  return TS_KIND_TO_LSP_KIND_MAP[tsKind] ?? CompletionItemKind.Variable;
}

/**
 * LSPの各機能（ドキュメント同期、補完、ホバーなど）のコアロジックを実装するクラス。
 * @export
 * @class LspServerCore
 */
export class LspServerCore {
  /** サーバーが提供する機能の定義 */
  static serverCapabilities = {
    textDocumentSync: 1, // 1: Full. ドキュメントの同期は常に全内容を送信する。
    completionProvider: {
      resolveProvider: true, // `completionItem/resolve` をサポート
      triggerCharacters: ['.', '"', '\'', '`',], // triggerCharacter を見て自動送信
    },
    hoverProvider: true, // `textDocument/hover` をサポート
    signatureHelpProvider: {triggerCharacters: ['(', ',']},
  };
  /**
   * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#diagnostic
   */
  static DiagnosticSeverity = {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4,
  };
  /** @type {Map<string, string> | null} - VFS用のデフォルトファイルマップ */
  #defaultMap;
  /** @type {ts.System | null} - VFSのシステムオブジェクト */
  #system;
  /** @type {vfs.VirtualTypeScriptEnvironment | null} - TypeScript仮想環境 */
  #env;
  /** @type {Promise<vfs.VirtualTypeScriptEnvironment> | null} - VFSの遅延初期化用Promise */
  #bootPromise = null;
  /** @type {Map<string, {text: string, version?: number}>} - URIをキーとするオープン中のファイル情報 */
  #openFiles = new Map();
  /** @type {ts.CompilerOptions} - 現在のTypeScriptコンパイラオプション */
  #compilerOptions;
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
      serverInfo: {name: 'ts-vfs-worker', version: ts.version ?? 'unknown'},
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
    return {echoed: params?.msg ?? '(no message)'};
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
    return {success: true};
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
        {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
        ts.version,
        false,
        ts
      );
      
      
      
      /*
      const url = `https://typescript.azureedge.net/cdn/${version}/typescript/lib/lib.dom.d.ts`
      const text = await fetch(url).then(r => r.text())
      vfs.set('/lib.dom.d.ts', text)
      */
      /*
      const map = await createDefaultMapFromCDN(ts, tsVersion, ts.ScriptTarget.ES2022, false, ts.ModuleKind.ESNext)
      const p5Dts = await fetch('https://esm.sh/@types/p5/index.d.ts').then(r => r.text())
      map.set('/node_modules/@types/p5/index.d.ts', p5Dts)
      */
      
      
      const system = vfs.createSystem(defaultMap);

      // LSPサーバーがコードを解析する際のルールを定義
      const compilerOptions = {
        // 生成するJSのバージョンを指定。'ES2015'以上でないとプライベート識別子(#)などでエラーになる
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler, // URLベースのimportなど、モダンなモジュール解決を許可する
        allowArbitraryExtensions: true, // .js や .ts 以外の拡張子を持つファイルをインポートできるようにする
        allowJs: true, // .js ファイルのコンパイルを許可する
        checkJs: true, // .js ファイルに対しても型チェックを行う (JSDocと連携)
        strict: true, // すべての厳格な型チェックオプションを有効にする (noImplicitAnyなどを含む)
        noUnusedLocals: true, // 未使用のローカル変数をエラーとして報告する
        noUnusedParameters: true, // 未使用の関数パラメータをエラーとして報告する
      };

      // 仮想環境を作成し、定義したコンパイラオプションを渡す
      const env = vfs.createVirtualTypeScriptEnvironment(
        system,
        [],
        ts,
        compilerOptions
      );
      
      

      this.#defaultMap = defaultMap;
      this.#system = system;
      this.#env = env;
      log('vfs booted (ts:', ts.version, ')');
      self.postMessage({method: '__ready'});
      return env;
    })();
    return this.#bootPromise;
  }

  /**
   * `textDocument/didOpen`通知のハンドラ。
   * @param {object} params - LSPのdidOpenパラメータ。
   */
  async 'textDocument/didOpen'(params) {
    const {textDocument} = params ?? {};
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
  }

  /**
   * `textDocument/didChange`通知のハンドラ。
   * @param {object} params - LSPのdidChangeパラメータ。
   */
  async 'textDocument/didChange'(params) {
    const {textDocument, contentChanges} = params ?? {};
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
    this.#openFiles.set(uri, {text});

    this.#updateFile(path, text);
  }

  /**
   * `textDocument/didClose`通知のハンドラ。
   * @param {object} params - LSPのdidCloseパラメータ。
   */
  async 'textDocument/didClose'(params) {
    const {textDocument} = params ?? {};
    if (!textDocument?.uri) {
      log('didClose: invalid params', params);
      return;
    }
    // ファイルを閉じたので、キャッシュから削除
    if (this.#openFiles.has(textDocument.uri)) {
      this.#openFiles.delete(textDocument.uri);
      log('didClose', textDocument.uri);
    }
  }

  /**
   * `textDocument/completion`リクエストのハンドラ。
   * @param {object} params - LSPのcompletionパラメータ。
   * @returns {Promise<object>} LSPのCompletionList。
   */
  async 'textDocument/completion'(params) {
    const {textDocument, position} = params ?? {};
    const uri = textDocument?.uri;
    if (!uri || !position) {
      return {isIncomplete: false, items: []};
    }
    await this.#bootVfs();
    const path = this.#uriToPath(uri);
    const doc = this.#openFiles.get(uri);
    const sourceFile = this.#env.languageService
      .getProgram()
      .getSourceFile(path);
    if (!sourceFile) {
      return {isIncomplete: false, items: []};
    }
    const offset = ts.getPositionOfLineAndCharacter(
      sourceFile,
      position.line,
      position.character
    );

    try {
      const completions = this.#env.languageService.getCompletionsAtPosition(
        path,
        offset,
        {}
      );
      const items = (completions?.entries ?? []).map((e) => ({
        label: e.name,
        kind: mapTsKindToLsp(e.kind), // `completionItem/resolve`で詳細を取得するために必要な情報をdataに詰める
        data: {path, offset, name: e.name},
      }));
      return {isIncomplete: !!completions?.isIncomplete, items};
    } catch (e) {
      log('completion failed', e);
      return {isIncomplete: false, items: []};
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
    const {data} = item;
    const d = this.#env.languageService.getCompletionEntryDetails(
      // `textDocument/completion`で詰めた情報を使って詳細を取得
      data.path,
      data.offset,
      data.name,
      undefined,
      undefined
    );
    return Object.assign({}, item, {
      detail: ts.displayPartsToString(d?.displayParts),
      documentation: ts.displayPartsToString(d?.documentation),
      insertText: d?.insertText ?? item.label,
      kind: mapTsKindToLsp(d?.kind ?? item.kind),
    });
  }

  /**
   * TypeScript の QuickInfo.displayParts から
   * 型の概要のみを抽出して文字列化する簡易関数。
   * 冗長な "const", "let", "function" などを省く。
   */
  #extractTypeSummary(displayParts = []) {
    if (!Array.isArray(displayParts)) return '';
    const filtered = displayParts.filter((p) => {
      // 除外対象: キーワード・空白・句読点・改行
      return !['keyword', 'punctuation', 'space'].includes(p.kind);
    });
    return filtered
      .map((p) => p.text)
      .join('')
      .trim();
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
      const sourceFile = this.#env.languageService
        .getProgram()
        .getSourceFile(path);
      if (!sourceFile) {
        return null;
      }
      const offset = ts.getPositionOfLineAndCharacter(
        sourceFile,
        position.line,
        position.character
      );

      const text = sourceFile.text;

      // TypeScript quick info
      const info = this.#env.languageService.getQuickInfoAtPosition(
        path,
        offset
      );
      if (!info) return null;

      // build markdown contents: code block of declaration + documentation
      const signature = ts.displayPartsToString(info.displayParts);
      //const signature = this.#extractTypeSummary(info.displayParts);
      const documentation = ts.displayPartsToString(info.documentation);

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
        const startPos = ts.getLineAndCharacterOfPosition(
          sourceFile,
          info.textSpan.start
        );
        const endPos = ts.getLineAndCharacterOfPosition(
          sourceFile,
          info.textSpan.start + (info.textSpan.length ?? 0)
        );
        range = {start: startPos, end: endPos};
      }

      return {
        contents: {
          kind: 'markdown',
          value: value || signature || documentation || '',
        },
        ...(range ? {range} : {}),
      };
    } catch (e) {
      log('hover failed', e);
      return null;
    }
  }

  /**
   * `textDocument/signatureHelp` リクエストのハンドラ。
   * TypeScript の signature help を取得して LSP の SignatureHelp 形式で返す。
   * @param {{ textDocument: { uri: string }, position: { line:number, character:number } }} params
   * @returns {Promise<null | { signatures: Array, activeSignature?: number, activeParameter?: number }>}
   */
  async 'textDocument/signatureHelp'(params) {
    const uri = params?.textDocument?.uri;
    const position = params?.position;
    if (!uri || !position) return null;

    try {
      await this.#bootVfs();
      const path = this.#uriToPath(uri);
      const doc = this.#openFiles.get(uri);
      const sourceFile = this.#env.languageService
        .getProgram()
        .getSourceFile(path);
      if (!sourceFile) {
        return null;
      }
      const offset = ts.getPositionOfLineAndCharacter(
        sourceFile,
        position.line,
        position.character
      );

      // TypeScript の signature help を取得
      // getSignatureHelpItems(fileName, position, options)
      const helpItems = this.#env.languageService.getSignatureHelpItems(
        path,
        offset,
        undefined
      );
      if (!helpItems) return null;

      // TypeScript の SignatureHelpItems -> LSP SignatureHelp へ変換
      const signatures = (helpItems.items || []).map((item) => {
        // シグネチャラベル(displayParts を結合)
        const label =
          ts.displayPartsToString(item.prefixDisplayParts) +
          (item.parameters || [])
            .map((p, i) => {
              const paramText = ts.displayPartsToString(
                item.parameters[i]?.displayParts ?? []
              );
              return paramText;
            })
            .join(ts.displayPartsToString(item.separatorDisplayParts) || ',') +
          ts.displayPartsToString(item.suffixDisplayParts);

        // ドキュメント(documentationParts がある場合)
        const documentation = ts.displayPartsToString(item.documentation ?? []);

        // パラメータ配列を LSP 形式に
        const parameters = (item.parameters || []).map((p) => {
          return {
            label: ts.displayPartsToString(p.displayParts) || p.name || '',
            documentation: ts.displayPartsToString(p.documentation ?? []),
          };
        });

        return {
          label,
          documentation: documentation || undefined,
          parameters,
        };
      });

      // TypeScript が示す activeSignature/activeParameter の情報があればそれを使う
      const activeSignature =
        typeof helpItems.selectedItemIndex === 'number'
          ? helpItems.selectedItemIndex
          : 0;
      const activeParameter =
        typeof helpItems.argumentIndex === 'number'
          ? helpItems.argumentIndex
          : 0;

      return {
        signatures,
        activeSignature,
        activeParameter,
      };
    } catch (e) {
      log('signatureHelp failed', e);
      return null;
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
      const syntactic =
        this.#env.languageService.getSyntacticDiagnostics(path) || [];
      const semantic =
        this.#env.languageService.getSemanticDiagnostics(path) || [];
      all = [...syntactic, ...semantic];
    } catch (e) {
      log('failed to get diagnostics from TS service for', uri, e);
      all = [];
    }

    // Convert to LSP Diagnostic[]
    const diagnostics = all.map((d) => {
      const sourceFile = this.#env.languageService
        .getProgram()
        .getSourceFile(path);
      const start = d.start ?? 0;
      const end = start + (d.length ?? 0);
      const range = {
        start: sourceFile
          ? ts.getLineAndCharacterOfPosition(sourceFile, start)
          : {line: 0, character: 0},
        end: sourceFile
          ? ts.getLineAndCharacterOfPosition(sourceFile, end)
          : {line: 0, character: 0},
      };
      return {
        range,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        severity: d.category === ts.DiagnosticCategory.Error ? 1 : 2, // LSP: 1 Error, 2 Warning
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
   * ファイルURIからVFSで使うパスに変換する。
   * @param {string} uri - ファイルURI。
   * @returns {string} VFS用のパス。
   */
  #uriToPath(uri) {
    return uri.replace(/^file:\/\/\/?/, '');
  }

  /**
   * VFSパスからファイルURIに変換する。
   * @param {string} path - VFS用のパス。
   * @returns {string} ファイルURI。
   */
  #pathToUri(path) {
    return 'file:///' + path;
  }

  /** VFSにファイルを作成または更新する */
  #updateFile(path, text) {
    if (this.#system.fileExists(path)) {
      this.#env.updateFile(path, text);
    } else {
      this.#env.createFile(path, text);
    }
    // 自動診断スケジュール
    const uri = 'file:///' + path;
    this.#scheduleDiagnostics(uri);
  }
}
