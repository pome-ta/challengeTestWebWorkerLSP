// core/lsp-core.js
// v0.0.2.4

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

import { postLog } from '../util/logger.js';
import { VfsCore } from './vfs-core.js';

let env = null;

const defaultCompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
};

/**
 * VFS環境を初期化または再利用します。
 */
function initializeEnvironment() {
  if (env) {
    postLog('🧠 Reusing existing VFS environment');
    return;
  }
  const defaultMap = VfsCore.getDefaultMap();
  if (!defaultMap) {
    throw new Error('VFS is not initialized. Cannot create LSP environment.');
  }
  const system = vfs.createSystem(defaultMap);
  env = vfs.createVirtualTypeScriptEnvironment(
    system,
    [],
    ts,
    defaultCompilerOptions
  );
  postLog('🧠 VFS environment created');
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
    };
  },
};
