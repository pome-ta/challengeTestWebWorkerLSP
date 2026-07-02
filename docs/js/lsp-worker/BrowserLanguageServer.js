import { TypeScriptEnv } from './core/TypeScriptEnv.js';
import { HoverProvider } from './providers/HoverProvider.js';
import { CompletionProvider } from './providers/CompletionProvider.js';
import { DiagnosticProvider } from './providers/DiagnosticProvider.js';
import { postLog } from './logger.js';
import { JsonRpcErrorCode } from './protocol/JsonRpcErrorCode.js';

export default class BrowserLanguageServer {
  #tsEnv;
  #providers = {};
  #activeUris = new Set();
  #ready = false;

  #requestHandlers = {
    initialize: (params) => this.#initialize(params),
    'textDocument/completion': (params) => this.#providers.completion.handle(params),
    'textDocument/hover': (params) => this.#providers.hover.handle(params),
  };

  #notificationHandlers = {
    initialized: () => postLog('Client and Server successfully connected.'),
    'textDocument/didOpen': (params) => this.#handleDidOpen(params),
    'textDocument/didChange': (params) => this.#handleDidChange(params),
    'textDocument/didClose': (params) => this.#handleDidClose(params),
  };

  constructor() {
    this.#tsEnv = new TypeScriptEnv();
  }

  async handleMessage(message) {
    const { id, method, params } = message;

    try {
      if (id !== undefined) {
        // --- Request の処理 ---
        const handler = this.#requestHandlers[method];
        if (!handler) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: JsonRpcErrorCode.MethodNotFound,
              message: `Method ${method} not implemented`,
            },
          };
        }

        if (method !== 'initialize' && !this.#ready) {
          throw new Error('Server is not ready yet');
        }

        const result = await handler(params);
        return result !== undefined ? { jsonrpc: '2.0', id, result } : null;
      } else {
        // --- Notification の処理 ---
        const handler = this.#notificationHandlers[method];
        if (handler && (this.#ready || method === 'initialized')) {
          handler(params);
        }
        return null;
      }
    } catch (err) {
      postLog(`Error handling ${method}: ${err.message}`, 1);
      if (id !== undefined) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: JsonRpcErrorCode.InternalError, message: String(err) },
        };
      }
      return null;
    }
  }

  // =========================================================================
  // 初期化とライフサイクル
  // =========================================================================
  async #initialize() {
    await this.#tsEnv.init(() => {
      for (const uri of this.#activeUris) {
        this.#providers.diagnostic.runDiagnostics(uri);
      }
    });

    this.#providers.hover = new HoverProvider(this.#tsEnv);
    this.#providers.completion = new CompletionProvider(this.#tsEnv);
    this.#providers.diagnostic = new DiagnosticProvider(this.#tsEnv);

    // パターンB：メインスレッド（エディタ側）の事情によって「動的に変わるモジュール」の場合
    // note: アプリケーション層の判断として、必要な独自モジュールをVFSに作成する
    // `import {hogehoge} from './src/utils/math.js';`
    //     this.#tsEnv.createFile(
    //       'file:///src/utils/math.js',
    //       `
    // /**
    //  * 2つの数値を加算します。
    //  * * @param {number} a - 1つ目の数値
    //  * @param {number} b - 2つ目の数値
    //  * @returns {number} a と b の合計値
    //  */
    // export function add(a, b) {
    //   return a + b;
    // }

    // /**
    //  * hogehoge処理（2つの数値を加算します）。
    //  * * @param {number} a - 1つ目の引数
    //  * @param {number} b - 2つ目の引数
    //  * @returns {number} 計算結果
    //  */
    // export function hogehoge(a, b) {
    //   return a + b;
    // }
    //       `,
    //     );

    this.#ready = true;

    return {
      capabilities: {
        textDocumentSync: 1, // Full Sync
        hoverProvider: true,
        completionProvider: {
          resolveProvider: false,
          triggerCharacters: ['.', '"', "'", '/', '@', '<'],
        },
      },
    };
  }

  #handleDidOpen(params) {
    const { uri, text } = params.textDocument;
    this.#activeUris.add(uri);

    const initialText = text.trim() === '' ? '\n' : text;
    this.#tsEnv.createFile(uri, initialText);
    postLog(`Opened file: ${uri}`);

    this.#providers.diagnostic.triggerDiagnostics(uri);
    this.#tsEnv.triggerATA(initialText);
  }

  #handleDidChange(params) {
    const { uri } = params.textDocument;
    const validText = params.contentChanges[0].text || '\n';

    this.#tsEnv.updateFile(uri, validText);

    this.#providers.diagnostic.triggerDiagnostics(uri);
    this.#tsEnv.triggerATA(validText);
  }

  #handleDidClose(params) {
    const { uri } = params.textDocument;
    this.#activeUris.delete(uri);
    this.#tsEnv.deleteFile(uri);
    postLog(`Closed file: ${uri}`);
  }
}
