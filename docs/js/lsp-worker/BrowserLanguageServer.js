import { TypeScriptEnv } from './core/TypeScriptEnv.js';
import { DocumentManager } from './core/DocumentManager.js';
import { HoverProvider } from './providers/HoverProvider.js';
import { CompletionProvider } from './providers/CompletionProvider.js';
import { DiagnosticProvider } from './providers/DiagnosticProvider.js';
import { postLog } from './logger.js';
import { JsonRpcErrorCode } from './protocol/JsonRpcErrorCode.js';

export default class BrowserLanguageServer {
  #tsEnv;
  #docManager;
  #providers = {};
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
    this.#docManager = new DocumentManager(this.#tsEnv);
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
      // ATA完了時: DocumentManagerから現在開いているファイル一覧をもらって診断を再実行
      for (const uri of this.#docManager.activeUris) {
        this.#providers.diagnostic.triggerDiagnostics(uri);
      }
    });

    this.#providers.hover = new HoverProvider(this.#tsEnv);
    this.#providers.completion = new CompletionProvider(this.#tsEnv);
    this.#providers.diagnostic = new DiagnosticProvider(this.#tsEnv);

    // パターンBの場合：ここで this.#tsEnv.createVirtualFile(...) を呼んで、
    // メインスレッドからの要求に応じた動的なモジュール注入も可能です。

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

    // 状態管理とVFSへの反映は DocumentManager へ委譲
    this.#docManager.openDocument(uri, text);

    this.#providers.diagnostic.triggerDiagnostics(uri);
    this.#tsEnv.triggerATA(text);
  }

  #handleDidChange(params) {
    const { uri } = params.textDocument;
    const text = params.contentChanges[0].text || '\n';

    this.#docManager.updateDocument(uri, text);

    this.#providers.diagnostic.triggerDiagnostics(uri);
    this.#tsEnv.triggerATA(text);
  }

  #handleDidClose(params) {
    const { uri } = params.textDocument;

    this.#docManager.closeDocument(uri);
  }
}
