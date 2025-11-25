// core/vfs-core.js
// v0.0.2.7
// 改訂版 — cachedDefaultMap を保護しつつ createEnvironment(initialFiles) を確実に行う実装

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

/**
 * モジュールスコープの状態
 */
let cachedDefaultMap = null; // Map<string, string>
let vfsReady = false;
let _ensurePromise = null;

/**
 * createDefaultMapFromCDN の取得をリトライする内部処理
 * @param {number} retryCount
 * @param {number} perAttemptTimeoutMs
 * @returns {Promise<Map<string,string>>}
 */
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
      const msg = String(error?.message ?? error);
      // ネットワーク系は環境に依存するので即失敗させる(テスト時の判別がしやすい)
      if (msg.includes('fetch') || msg.includes('NetworkError')) {
        postLog(`🚫 Network error while fetching defaultMap: ${msg}`);
        throw error;
      }
      // タイムアウトはリトライ
      if (msg.includes('timeout')) {
        postLog(`⏰ Timeout on attempt ${attempt}, retrying after backoff`);
        await sleep(1000 * attempt);
        continue;
      }
      // それ以外はログを出して再スロー
      postLog(`❌ createDefaultMapWithRetries unknown error: ${msg}`);
      throw error;
    }
  }

  throw lastError || new Error('VFS init failed after retries');
}

/**
 * shallow clone of Map<string,string>
 * - cachedDefaultMap の参照を安全に扱うために使う
 * @param {Map<string,string>} src
 * @returns {Map<string,string>}
 */
function mapClone(src) {
  // 単純な浅コピーで十分(Map の値は文字列である想定)
  return new Map(src);
}

/**
 * VFS の準備を行う。並列呼び出しに耐える。
 * @param {number} retry
 * @param {number} timeoutMs
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
        postLog('📦 Using existing cachedDefaultMap (populate)');
      }
      vfsReady = true;
      postLog('✅ VFS ensureReady complete');
    } finally {
      _ensurePromise = null;
    }
  })();

  return _ensurePromise;
}

/**
 * 現在保持している default map を返す (読み取り専用扱いを期待)
 * @returns {Map<string,string>|null}
 */
export function getDefaultMap() {
  return cachedDefaultMap;
}

/**
 * デフォルトの compilerOptions を得る
 * @returns {import('typescript').CompilerOptions}
 */
export function getDefaultCompilerOptions() {
  return {
    target: ts.ScriptTarget.ES2022, // 生成するJSのバージョンを指定。'ES2015'以上でないとプライベート識別子(#)などでエラー
    moduleResolution: ts.ModuleResolutionKind.Bundler, // URLベースのimportなど、モダンなモジュール解決を許可する
    allowArbitraryExtensions: true, // .js や .ts 以外の拡張子を持つファイルをインポートできるようにする
    allowJs: true, // .js ファイルのコンパイルを許可する
    checkJs: true, // .js ファイルに対しても型チェックを行う (JSDocと連携)
    strict: true, // すべての厳格な型チェックオプションを有効にする (noImplicitAnyなどを含む)
    noUnusedLocals: true, // 未使用のローカル変数をエラーとして報告する
    noUnusedParameters: true, // 未使用の関数パラメータをエラーとして報告する
  
  };
}

/**
 * createEnvironment
 * - rootFiles: array of absolute paths (e.g. ['/file1.ts'])
 * - initialFiles: object mapping absolute path -> content (or uri -> content)
 *
 * 実装方針:
 * 1) cachedDefaultMap をクローンして environment 用の map を作る(元を壊さない)
 * 2) クローン map に initialFiles を注入 -> system を作る
 * 3) createVirtualTypeScriptEnvironment(system, rootPaths, ts, opts)
 * 4) env 作成後、念のため env.updateFile/createFile で content を再同期(vfs 実装差の吸収)
 *
 * @param {object} compilerOptions
 * @param {string[]} rootFiles
 * @param {{[path:string]: string}} initialFiles
 * @returns {import('@typescript/vfs').VirtualTypeScriptEnvironment}
 */
export function createEnvironment(compilerOptions = {}, rootFiles = [], initialFiles = {}) {
  if (!cachedDefaultMap) {
    throw new Error('VFS not initialized. Call ensureReady() first.');
  }

  // 1) defaultMap をクローンして破壊を避ける
  const mapForEnv = mapClone(cachedDefaultMap);

  // normalize and inject initialFiles into cloned map BEFORE creating system
  const normalizedInitialFiles = {};
  for (const [rawKey, content] of Object.entries(initialFiles || {})) {
    try {
      const key = String(rawKey).replace(/^file:\/\//, '');
      normalizedInitialFiles[key] = String(content ?? '');
      mapForEnv.set(key, String(content ?? ''));
      postLog(`🧩 createEnvironment: injected initial file into cloned map: ${key}`);
    } catch (e) {
      postLog(`⚠️ createEnvironment: failed to inject initial file ${rawKey}: ${String(e?.message ?? e)}`);
    }
  }

  // 2) system を作る(Map を渡す)
  const system = vfs.createSystem(mapForEnv);

  // 3) rootPaths を正規化
  const rootPaths = (rootFiles || []).map((r) => String(r).replace(/^file:\/\//, ''));

  // 4) compilerOptions のマージ
  const defaultOptions = getDefaultCompilerOptions();
  const opts = Object.assign({}, defaultOptions, compilerOptions);

  // 5) env の作成
  const env = vfs.createVirtualTypeScriptEnvironment(system, rootPaths, ts, opts);
  postLog(`🧠 VFS environment created (via createEnvironment); roots: [${rootPaths.join(', ')}]`);

  // 6) 抜けがあれば env 側に確実に反映(いくつかの vfs 実装は system 書込みを即時 env に反映しない)
  for (const [path, content] of Object.entries(normalizedInitialFiles)) {
    try {
      if (env.getSourceFile && env.getSourceFile(path)) {
        env.updateFile(path, content);
      } else {
        env.createFile(path, content);
      }
    } catch (e) {
      postLog(`⚠️ createEnvironment sync file apply failed for ${path}: ${String(e?.message ?? e)}`);
    }
  }

  // 7) prime the language service program (defensive)
  try {
    env.languageService.getProgram();
  } catch (e) {
    postLog(`⚠️ getProgram() failed right after env creation: ${String(e?.message ?? e)}`);
  }

  return env;
}

/**
 * テスト用: 内部 state をリセットする
 */
export function resetForTest() {
  cachedDefaultMap = null;
  vfsReady = false;
  _ensurePromise = null;
  postLog('♻️ VfsCore resetForTest() called');
}

/**
 * 状態を含めた外向け API
 */
export const VfsCore = {
  ensureReady,
  isReady: () => vfsReady,
  getDefaultMap,
  createEnvironment,
  getDefaultCompilerOptions,
  resetForTest,
};
