// core/lsp-core.js
// v0.0.2.6

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

import { postLog } from '../util/logger.js';
import { VfsCore } from './vfs-core.js';
/**
 * LSPのコアロジックをカプセル化するクラス。
 * 状態（VFS環境、開いているファイルなど）を管理し、LSPメソッドを処理する。
 */
class LspServer {
  /** @type {import('@typescript/vfs').VirtualTypeScriptEnvironment | null} */
  #env = null;
  /** @type {Map<string, { text: string, version: number }>} */
  #openFiles = new Map();
  /** @type {ts.CompilerOptions} */
  #compilerOptions = {};
  /** @type {Map<string, number>} */
  #diagTimers = new Map();
  #diagnosticDebounceMs = 300;

  constructor() {
    postLog('✨ LspServer instance created');
  }

  async initialize(params = {}) {
    this.#compilerOptions =
      params.initializationOptions?.compilerOptions ||
      VfsCore.getDefaultCompilerOptions();

    await VfsCore.ensureReady();
    // 初期状態ではルートファイルは空で、didOpenで動的に追加していく
    this.#env = VfsCore.createEnvironment(this.#compilerOptions, []);
    postLog('✅ LspServer initialized, env created.');
  }

  getInitializeResult() {
    return {
      capabilities: {
        textDocumentSync: 1, // Full sync
      },
      serverInfo: {
        name: 'WebWorker-LSP-Server',
        version: '0.0.2',
      },
    };
  }

  async didOpen(params) {
    const { uri, text, version } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`📄 didOpen ${path} (version:${version})`);

    this.#openFiles.set(uri, { text, version });
    this.#updateVfsFile(path, text);
    this.#recreateEnv();
    this.#scheduleDiagnostics(uri);
  }

  async didChange(params) {
    const { uri, version } = params.textDocument;
    const text = params.contentChanges[0]?.text;
    if (typeof text !== 'string') return;

    const path = this.#uriToPath(uri);
    postLog(`✏️ didChange ${path} (version:${version})`);

    this.#openFiles.set(uri, { text, version });
    this.#updateVfsFile(path, text);
    this.#scheduleDiagnostics(uri);
  }

  async didClose(params) {
    const { uri } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`📕 didClose ${path}`);

    this.#openFiles.delete(uri);
    this.#recreateEnv();
    this.#clearDiagnostics(uri);
  }

  #updateVfsFile(path, text) {
    if (!this.#env) return;
    const existing = this.#env.getSourceFile(path);
    if (existing) {
      this.#env.updateFile(path, text);
    } else {
      this.#env.createFile(path, text);
    }
  }

  #recreateEnv() {
    // 1. 現在開いているすべてのファイルのパスを収集し、新しい環境のルートファイルとして指定
    const allKnownFilePaths = Array.from(this.#openFiles.keys()).map(this.#uriToPath);

    // 2. これらのルートファイルを持つ新しいVirtualTypeScriptEnvironmentを生成
    //    これにより、言語サービスはこれらのファイルをプロジェクトの一部として認識する
    this.#env = VfsCore.createEnvironment(this.#compilerOptions, allKnownFilePaths);

    // 3. 新しく生成された環境に、各ファイルの最新の内容を反映させる
    //    VfsCore.createEnvironmentはrootFilesのパスを登録するが、その内容までは保証しないため、
    //    updateFileを呼び出して内容を確実に設定する。
    for (const [uri, { text }] of this.#openFiles.entries()) {
      const path = this.#uriToPath(uri);
      this.#env.updateFile(path, text);
    }
    // 4. プログラムが最新の状態であることを保証するために、明示的にプログラムを取得
    this.#env.languageService.getProgram();
  }

  #scheduleDiagnostics(uri) {
    if (this.#diagTimers.has(uri)) {
      clearTimeout(this.#diagTimers.get(uri));
    }
    const timer = setTimeout(() => {
      this.publishDiagnostics(uri);
      this.#diagTimers.delete(uri);
    }, this.#diagnosticDebounceMs);
    this.#diagTimers.set(uri, Number(timer));
  }

  async publishDiagnostics(uri) {
    if (!this.#env) return;
    const path = this.#uriToPath(uri);

    const syntactic = this.#env.languageService.getSyntacticDiagnostics(path);
    const semantic = this.#env.languageService.getSemanticDiagnostics(path);
    const allDiags = [...syntactic, ...semantic];

    const diagnostics = allDiags.map((d) => this.#tsDiagToLsp(d, path));

    postLog(`Publishing ${diagnostics.length} diagnostics for ${path}`);
    self.postMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics },
    });
  }

  #clearDiagnostics(uri) {
    self.postMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics: [] },
    });
  }

  #tsDiagToLsp(diag, path) {
    const sourceFile = this.#env.languageService.getProgram().getSourceFile(path);
    const start = diag.start ?? 0;
    const length = diag.length ?? 0;
    const startPos = sourceFile
      ? ts.getLineAndCharacterOfPosition(sourceFile, start)
      : { line: 0, character: 0 };
    const endPos = sourceFile
      ? ts.getLineAndCharacterOfPosition(sourceFile, start + length)
      : { line: 0, character: 0 };

    return {
      range: { start: startPos, end: endPos },
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      severity: diag.category + 1, // TS(0-3) -> LSP(1-4)
      source: 'ts',
      code: diag.code,
    };
  }

  #uriToPath(uri) {
    return uri.replace(/^file:\/\//, '');
  }
}

/** @type {LspServer | null} */
let server = null;

/**
 * サーバーインスタンスを遅延初期化して取得します。
 * @returns {Promise<LspServer>}
 */
async function getServer() {
  if (!server) {
    server = new LspServer();
    // `initialize`は明示的に呼び出す必要があるため、ここでは生成のみ
  }
  return server;
}

/**
 * LSP initialize
 * @param {object} params
 */
export const LspCore = {
  initialize: async (params = {}) => {
    postLog(`LSP initialize params: ${JSON.stringify(params)}`);
    const server = await getServer();
    await server.initialize(params);
    return server.getInitializeResult();
  },

  /**
   * textDocument/didOpen
   * params: { textDocument: { uri, languageId, version, text } }
   */
  didOpen: async (params) => {
    const server = await getServer();
    await server.didOpen(params);
  },

  /**
   * textDocument/didChange
   * params: { textDocument: { uri, version }, contentChanges: [{ text }] }
   */
  didChange: async (params) => {
    const server = await getServer();
    await server.didChange(params);
  },

  /**
   * textDocument/didClose
   * params: { textDocument: { uri } }
   */
  didClose: async (params) => {
    const server = await getServer();
    await server.didClose(params);
  },

  /**
   * publishDiagnostics を外から呼べるようにする（テスト用など）
   */
  publishDiagnostics: async (uri) => {
    const server = await getServer();
    await server.publishDiagnostics(uri);
  },
};
