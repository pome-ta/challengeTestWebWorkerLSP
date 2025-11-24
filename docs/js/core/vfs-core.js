// core/vfs-core.js
// v0.0.2.6

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

/*
  変更点（要旨）
  - cachedDefaultMap をモジュールスコープで持つが、ensureReady は並行呼び出しに耐えるように単一の Promise を返す。
  - createEnvironment() を追加して、LSP 側が簡潔に env を作れるようにする（責務の分離）。
  - エラーハンドリングを丁寧に（fetch系は即失敗、timeout はリトライ）。
*/

let cachedDefaultMap = null;
let vfsReady = false;
let _ensurePromise = null;

/**
 * CDNからTypeScriptのdefault libを取得しMapを作成する（リトライ付き）。
 * @param {number} retryCount
 * @param {number} perAttemptTimeoutMs
 * @returns {Promise<Map<string,string>>}
 */
async function createDefaultMapWithRetries(
  retryCount = 3,
  perAttemptTimeoutMs = 5000
) {
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
      // ネットワーク系は再試行しない（fetch 系は環境依存で致命的なことが多い）
      if (
        error &&
        error.message &&
        (error.message.includes('fetch') ||
          error.message.includes('NetworkError'))
      ) {
        postLog(`🚫 Network error (give up): ${error.message}`);
        throw error;
      }
      // タイムアウト等はリトライ
      if (error && error.message && error.message.includes('timeout')) {
        postLog(`⏰ Timeout on attempt ${attempt}, will retry after backoff`);
        await sleep(1000 * attempt); // backoff: 1s, 2s, ...
        continue;
      }
      // その他のエラーは上位に投げる
      postLog(
        `❌ createDefaultMapWithRetries unknown error: ${
          error?.message ?? String(error)
        }`
      );
      throw error;
    }
  }

  throw lastError || new Error('VFS init failed after retries');
}

/**
 * VFS を準備する。複数呼び出しが同時来ても createDefaultMap は一度だけ実行される。
 * @returns {Promise<void>}
 */
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
      // resolve したら _ensurePromise はクリア（次回は再取得可能）
      _ensurePromise = null;
    }
  })();

  return _ensurePromise;
}

/**
 * VFS の defaultMap を返す（読み取り専用）。
 * @returns {Map<string,string>|null}
 */
export function getDefaultMap() {
  return cachedDefaultMap;
}

function getDefaultCompilerOptions() {
  const defaultOptions = {
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
  };
  return defaultOptions;
}

/**
 * 新しい VirtualTypeScriptEnvironment を生成して返す。
 * - 呼び出し前に ensureReady() を呼ぶこと。
 * @param {object} compilerOptions - optional
 * @param {string[]} rootFiles - プロジェクトのルートファイルパスの配列
 * @returns {import('@typescript/vfs').VirtualTypeScriptEnvironment}
 */
export function createEnvironment(compilerOptions = {}, rootFiles = []) {
  if (!cachedDefaultMap) {
    throw new Error('VFS not initialized. Call ensureReady() first.');
  }
  const system = vfs.createSystem(cachedDefaultMap);
  const defaultOptions = getDefaultCompilerOptions();
  const opts = Object.assign({}, defaultOptions, compilerOptions);
  const rootPaths = rootFiles.map((uri) => uri.replace(/^file:\/\//, ''));
  const env = vfs.createVirtualTypeScriptEnvironment(system, rootPaths, ts, opts);
  postLog('🧠 VFS environment created (via createEnvironment)');
  return env;
}

/**
 * テスト/デバッグ用: cache をリセットする。
 */
export function resetForTest() {
  cachedDefaultMap = null;
  vfsReady = false;
  _ensurePromise = null;
  postLog('♻️ VfsCore resetForTest() called');
}

/**
 * 現状の状態を返す
 */
export const VfsCore = {
  ensureReady,
  isReady: () => vfsReady,
  getDefaultMap,
  createEnvironment,
  getDefaultCompilerOptions,
  resetForTest,
};
