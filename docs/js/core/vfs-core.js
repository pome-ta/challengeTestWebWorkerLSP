// core/vfs-core.js
// v0.0.2.6
// 変更点要約:
// - createEnvironment に `initialFiles` 引数を追加 (path -> text オブジェクト)
// - createEnvironment は system に先にファイルを書き込んでから createVirtualTypeScriptEnvironment を呼ぶ
// - getDefaultCompilerOptions をエクスポート (Lsp 側で利用)
// - ensureReady は並列呼び出しに安全

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

let cachedDefaultMap = null;
let vfsReady = false;
let _ensurePromise = null;

async function createDefaultMapWithRetries(retryCount = 3, perAttemptTimeoutMs = 5000) {
  let lastError = null;

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    postLog(`🔄 VFS init attempt ${attempt}/${retryCount}`);
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), perAttemptTimeoutMs)
      );

      const defaultMap = await Promise.race([
        vfs.createDefaultMapFromCDN(
          {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
          ts.version,
          false,
          ts
        ),
        timeout,
      ]);

      postLog(`📦 defaultMap size: ${defaultMap.size}`);
      return defaultMap;
    } catch (error) {
      lastError = error;
      if (error && error.message && (error.message.includes('fetch') || error.message.includes('NetworkError'))) {
        postLog(`🚫 Network error (give up): ${error.message}`);
        throw error;
      }
      if (error && error.message && error.message.includes('timeout')) {
        postLog(`⏰ Timeout on attempt ${attempt}, retry after backoff`);
        await sleep(1000 * attempt);
        continue;
      }
      postLog(`❌ createDefaultMapWithRetries unknown error: ${error?.message ?? String(error)}`);
      throw error;
    }
  }

  throw lastError || new Error('VFS init failed after retries');
}

export async function ensureReady(retry = 3, timeoutMs = 5000) {
  if (vfsReady && cachedDefaultMap) {
    postLog('📦 Using existing cachedDefaultMap (already ready)');
    return;
  }
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    try {
      if (!cachedDefaultMap) {
        cachedDefaultMap = await createDefaultMapWithRetries(retry, timeoutMs);
      } else {
        postLog('📦 Using existing cachedDefaultMap');
      }
      vfsReady = true;
      postLog('✅ VFS ensureReady complete');
    } finally {
      _ensurePromise = null;
    }
  })();

  return _ensurePromise;
}

export function getDefaultMap() {
  return cachedDefaultMap;
}

export function getDefaultCompilerOptions() {
  return {
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
  };
}

/**
 * createEnvironment の改良点:
 * - rootFiles: array of absolute paths (like '/file1.ts')
 * - initialFiles: object { '/file1.ts': 'content', '/file2.ts': '...' }
 *   -> createEnvironment は system に先にファイルを書き込む (write/create)
 */
export function createEnvironment(compilerOptions = {}, rootFiles = [], initialFiles = {}) {
  if (!cachedDefaultMap) {
    throw new Error('VFS not initialized. Call ensureReady() first.');
  }

  // create system from cached default map
  const system = vfs.createSystem(cachedDefaultMap);

  // ensure initial files are present in the system BEFORE creating the environment
  // initialFiles keys may be absolute paths or URIs; normalize to absolute path (no file://)
  for (const [key, content] of Object.entries(initialFiles || {})) {
    const path = String(key).replace(/^file:\/\//, '');
    // Use system.writeFile if available, otherwise vfs helpers via env later
    try {
      if (typeof system.writeFile === 'function') {
        system.writeFile(path, content);
      } else {
        // fallback: set in the map (cachedDefaultMap is a Map but system may have setFile)
        // createSystem provides a 'writeFile' normally; this fallback is defensive.
        postLog(`⚠️ system.writeFile not available for ${path}, skipping direct write`);
      }
    } catch (e) {
      postLog(`⚠️ Failed to write initial file ${path} into system: ${e?.message ?? String(e)}`);
    }
  }

  // normalize root paths (strip file:// if any)
  const rootPaths = (rootFiles || []).map((r) => String(r).replace(/^file:\/\//, ''));

  const defaultOptions = getDefaultCompilerOptions();
  const opts = Object.assign({}, defaultOptions, compilerOptions);

  const env = vfs.createVirtualTypeScriptEnvironment(system, rootPaths, ts, opts);
  postLog(`🧠 VFS environment created (via createEnvironment); roots: [${rootPaths.join(', ')}]`);

  // After env creation, ensure that environment's files have content matching initialFiles
  // (some vfs implementations may not pick up system.writeFile into env source file content)
  for (const [key, content] of Object.entries(initialFiles || {})) {
    const path = String(key).replace(/^file:\/\//, '');
    try {
      // If env has file, update it; else create it.
      if (env.getSourceFile && env.getSourceFile(path)) {
        env.updateFile(path, content);
      } else {
        env.createFile(path, content);
      }
    } catch (e) {
      postLog(`⚠️ createEnvironment sync file apply failed for ${path}: ${e?.message ?? String(e)}`);
    }
  }

  // prime the language service program
  try {
    env.languageService.getProgram();
  } catch (e) {
    postLog(`⚠️ getProgram() failed right after env creation: ${e?.message ?? String(e)}`);
  }

  return env;
}

export function resetForTest() {
  cachedDefaultMap = null;
  vfsReady = false;
  _ensurePromise = null;
  postLog('♻️ VfsCore resetForTest() called');
}

export const VfsCore = {
  ensureReady,
  isReady: () => vfsReady,
  getDefaultMap,
  createEnvironment,
  getDefaultCompilerOptions,
  resetForTest,
};
