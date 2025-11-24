// core/lsp-core.js
// v0.0.2.6

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

import { postLog } from '../util/logger.js';
import { VfsCore } from './vfs-core.js';

/*
  変更点（要旨）
  - initialize を async にして VfsCore.ensureReady() を待つ
  - env は VfsCore.createEnvironment() で生成・再利用
  - didOpen/didChange/didClose を実装（TextDocument 管理の最低限）
  - publishDiagnostics: TS 診断 -> LSP 診断への変換（位置も計算）
  - エラーハンドリングと堅牢性を改善
*/

let env = null;
const knownFiles = new Map(); // uri -> {path, version}
let compilerOptions = {};

/**
 * 内部: 簡潔に env を用意する（ensureReady を含む）。
 */
async function ensureEnvReady(compilerOptions = {}) {
  if (env) return env;
  // VFS が準備されていることを保証
  await VfsCore.ensureReady();
  compilerOptions = VfsCore.getDefaultCompilerOptions();
  env = VfsCore.createEnvironment(compilerOptions);
  return env;
}

/**
 * TypeScript の diagnostic の messageText を文字列化する（chain 対応）。
 */
function diagMessageTextToString(messageText) {
  if (!messageText) return '';
  if (typeof messageText === 'string') return messageText;
  // DiagnosticMessageChain
  let text = '';
  let node = messageText;
  while (node) {
    text += node.messageText;
    node = node.next && node.next.length ? node.next[0] : null;
    if (node) text += '\n';
  }
  return text;
}

/**
 * TS Diagnostic -> LSP Diagnostic に変換する
 * @param {import('typescript').Diagnostic} diag
 * @param {ts.SourceFile | undefined} sourceFile
 */
function tsDiagToLsp(diag, sourceFile) {
  const message = diagMessageTextToString(diag.messageText);
  let range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };

  try {
    if (typeof diag.start === 'number' && sourceFile) {
      const start = diag.start;
      const length = typeof diag.length === 'number' ? diag.length : 0;
      const endPos = start + length;

      const startLC = ts.getLineAndCharacterOfPosition(sourceFile, start);
      const endLC = ts.getLineAndCharacterOfPosition(
        sourceFile,
        Math.max(0, endPos)
      );
      range = {
        start: { line: startLC.line, character: startLC.character },
        end: { line: endLC.line, character: endLC.character },
      };
    }
  } catch (e) {
    // 位置計算に失敗したらデフォルトの range を使う
    postLog(`⚠️ range conversion failed: ${e?.message ?? String(e)}`);
  }

  // LSP severity: 1=Error,2=Warning,3=Information,4=Hint
  const severity = diag.category != null ? diag.category + 1 : 1;

  return {
    range,
    severity,
    source: 'ts',
    message,
    code: diag.code,
  };
}

/**
 * 指定ファイルの診断を計算して、textDocument/publishDiagnostics をポストする。
 * @param {string} uri
 */
function publishDiagnostics(uri) {
  if (!env) {
    postLog('⚠️ publishDiagnostics called but env is not initialized');
    return;
  }
  const path = uri.replace('file://', '');
  const sourceFile = env.getSourceFile ? env.getSourceFile(path) : undefined;

  const syntactic = env.languageService.getSyntacticDiagnostics(path) || [];
  const semantic = env.languageService.getSemanticDiagnostics(path) || [];
  const all = [...syntactic, ...semantic];

  const diagnostics = all.map((d) => tsDiagToLsp(d, sourceFile));

  self.postMessage({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { uri, diagnostics },
  });
}

/**
 * LSP initialize
 * @param {object} params
 */
export const LspCore = {
  initialize: async (params = {}) => {
    compilerOptions = params.initializationOptions?.compilerOptions || {};
    postLog(`LSP initialize params: ${JSON.stringify(params)}`);

    // VFS の準備と env の初期化を待つ
    await ensureEnvReady();

    // サーバ情報と capabilities を返す（現時点は最小限）
    return {
      capabilities: {
        // textDocumentSync etc. を後で追加可能
      },
      serverInfo: {
        name: 'WebWorker-LSP-Server',
        version: '0.0.2',
      },
    };
  },

  /**
   * textDocument/didOpen
   * params: { textDocument: { uri, languageId, version, text } }
   */
  didOpen: async (params) => {
    try {
      await ensureEnvReady();
      const { uri, text, version } = params.textDocument;
      const path = uri.replace('file://', '');

      postLog(`📄 didOpen ${path} (version:${version ?? 'n/a'})`);

      if (knownFiles.has(uri)) {
        // 既存なら update
        env.updateFile(path, text);
        knownFiles.set(uri, { path, version });
      } else {
        // 新規なら create
        env.createFile(path, text);
        knownFiles.set(uri, { path, version });
      }

      // envにプロジェクトの全体像を教える
      // これがマルチファイル解決の鍵
      env.updateCompilerOptions({ ...compilerOptions, rootFiles: Array.from(knownFiles.keys()).map(u => u.replace('file://', '')) });

      // 診断を実行
      publishDiagnostics(uri); // まずは開いたファイル自身を診断

      return { success: true };
    } catch (error) {
      postLog(`❌ didOpen error: ${error?.message ?? String(error)}`);
      throw error;
    }
  },

  /**
   * textDocument/didChange
   * params: { textDocument: { uri, version }, contentChanges: [{ text }] }
   */
  didChange: async (params) => {
    try {
      await ensureEnvReady();
      const { uri, version } = params.textDocument;
      const changes = params.contentChanges || [];
      const path = uri.replace('file://', '');

      postLog(`✏️ didChange ${path} (version:${version ?? 'n/a'})`);

      // 単純化: 最後の change.text を全文置換とする（incremental handling は後続）
      if (!knownFiles.has(uri)) {
        // file was not open, create it
        const text = changes.length ? changes[changes.length - 1].text : '';
        env.createFile(path, text);
        knownFiles.set(uri, { path, version });
      } else {
        const text = changes.length
          ? changes[changes.length - 1].text
          : env.getSourceFile(path)?.text ?? '';
        env.updateFile(path, text);
        knownFiles.set(uri, { path, version });
      }

      // ファイル内容が変わったので、プロジェクトの定義を再認識させる
      env.updateCompilerOptions({ ...compilerOptions, rootFiles: Array.from(knownFiles.keys()).map(u => u.replace('file://', '')) });

      publishDiagnostics(uri);

      return { success: true };
    } catch (error) {
      postLog(`❌ didChange error: ${error?.message ?? String(error)}`);
      throw error;
    }
  },

  /**
   * textDocument/didClose
   * params: { textDocument: { uri } }
   */
  didClose: async (params) => {
    try {
      const { uri } = params.textDocument;
      const path = uri.replace('file://', '');
      postLog(`📕 didClose ${path}`);

      knownFiles.delete(uri);

      // プロジェクトのファイル構成が変わったので、定義を再認識させる
      if (env) { // envが一度も作られていない場合は不要
        env.updateCompilerOptions({ ...compilerOptions, rootFiles: Array.from(knownFiles.keys()).map(u => u.replace('file://', '')) });
      }

      // publish empty diagnostics to clear issues
      self.postMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: [] },
      });
      return { success: true };
    } catch (error) {
      postLog(`❌ didClose error: ${error?.message ?? String(error)}`);
      throw error;
    }
  },

  /**
   * publishDiagnostics を外から呼べるようにする（テスト用など）
   */
  publishDiagnostics,
};
