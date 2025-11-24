// core/lsp-core.js
// v0.0.2.4

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

import { postLog } from '../util/logger.js';
import { VfsCore } from './vfs-core.js';

let env = null;
const knownFiles = new Set(); // VFSに存在するファイルのURIを管理する

const defaultCompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
};

/**
 * VFS環境を初期化または再利用します。
 */
function initializeEnvironment() {
  if (env) return; // 一度だけ初期化する
  const defaultMap = VfsCore.getDefaultMap();
  if (!defaultMap) {
    throw new Error('VFS is not initialized. Cannot create LSP environment.');
  }
  const system = vfs.createSystem(defaultMap);
  env = vfs.createVirtualTypeScriptEnvironment(
    system,
    [], // ルートファイルは空で開始し、動的に追加する
    ts,
    defaultCompilerOptions
  );
  postLog('🧠 VFS environment created');
}

/**
 * 指定されたファイルの診断情報（エラーなど）を取得し、クライアントに通知します。
 * @param {string} uri - ファイルのURI
 */
function publishDiagnostics(uri) {
  if (!env) return;

  const path = uri.replace('file://', '');
  const syntacticDiagnostics = env.languageService.getSyntacticDiagnostics(path);
  const semanticDiagnostics = env.languageService.getSemanticDiagnostics(path);

  // 診断情報をLSPフォーマットに変換
  const diagnostics = [...syntacticDiagnostics, ...semanticDiagnostics].map(
    (diag) => {
      return {
        range: {}, // 簡単のため、今回はrangeを空にする
        severity: diag.category + 1, // ts.DiagnosticCategory to LSP DiagnosticSeverity
        source: 'ts',
        message: typeof diag.messageText === 'string' ? diag.messageText : diag.messageText.messageText,
      };
    }
  );

  self.postMessage({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { uri, diagnostics },
  });
}

export const LspCore = {
  /**
   * LSPセッションを初期化します。
   * @param {object} params - クライアントからの初期化パラメータ
   * @returns {{capabilities: object}} サーバーの機能
   */
  initialize: (params) => {
    postLog(`Initializing LSP with params: ${JSON.stringify(params)}`);

    // TypeScriptの言語サービス環境を準備します
    initializeEnvironment();

    // このサーバーが提供できる機能をクライアントに伝えます
    return {
      capabilities: {
        // 今後実装する機能を追加していきます
      },
      serverInfo: {
        name: 'WebWorker-LSP-Server',
        version: '0.0.2',
      },
    };
  },

  /**
   * ドキュメントが開かれたときの通知を処理します。
   * @param {{textDocument: {uri: string, text: string}}} params
   */
  didOpen: (params) => {
    const { uri, text } = params.textDocument;
    const path = uri.replace('file://', '');
    postLog(`📄 didOpen: ${path}`);
    
    if (!env) {
      throw new Error('LSP environment not initialized. Call `lsp/initialize` first.');
    }

    // v0.0.1の成功事例に倣い、createFile/updateFileを使い分ける
    if (knownFiles.has(uri)) {
      env.updateFile(path, text);
    } else {
      env.createFile(path, text);
      knownFiles.add(uri);
    }

    // didOpenされたファイル自身のエラーをチェックして通知する
    // 関連ファイルのエラーは、didChangeなどで別途ハンドリングする
    publishDiagnostics(uri);
  },
};
