// core/lsp-core.js
// v0.0.2.1

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

/**
 * LSP関連の処理を実行する前に、VFSの準備ができていることを確認します。
 */
function ensureVfsReady() {
  if (!VfsCore.isReady()) {
    throw new Error('VFS not ready. Call `vfs/ensureReady` first.');
  }
}

export const LspCore = {
  // 今後、ここにLSPのコア機能（didOpen, didChangeなど）を実装します。
};
