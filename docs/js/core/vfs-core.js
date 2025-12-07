// core/vfs-core.js
// v0.0.3.2

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

class VfsCoreClass {
  // private state(インスタンス内に隠蔽)
  #cachedDefaultMap = null;
  #vfsReady = false;
  #ensurePromise = null;

  // private: パス正規化
  #normalizeVfsPath(p) {
    if (!p) return '';
    let s = String(p).replace(/^file:\/\//, '');
    if (!s.startsWith('/')) s = `/${s}`;
    return s;
  }

  // private: map の浅いクローン
  #mapClone(src) {
    return new Map(src);
  }

  // private: CDN から defaultMap を取得(リトライ付き)
  async #createDefaultMapWithRetries(retryCount = 3, perAttemptTimeoutMs = 5000) {
    let lastError = null;
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      postLog(`VFS init attempt ${attempt}/${retryCount}`);
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

        postLog(`defaultMap size: ${defaultMap.size}`);
        return defaultMap;
      } catch (error) {
        lastError = error;
        const msg = String(error?.message ?? error);
        if (msg.includes('fetch') || msg.includes('NetworkError')) {
          postLog(`Network error while fetching defaultMap: ${msg}`);
          throw error;
        }
        if (msg.includes('timeout')) {
          postLog(`Timeout on attempt ${attempt}, retrying after backoff`);
          await sleep(1000 * attempt);
          continue;
        }
        postLog(`createDefaultMapWithRetries unknown error: ${msg}`);
        throw error;
      }
    }
    throw lastError || new Error('VFS init failed after retries');
  }

  // public: ensure defaultMap が準備されるまで待つ
  async ensureReady(retry = 3, timeoutMs = 5000) {
    if (this.#vfsReady && this.#cachedDefaultMap) {
      postLog('Using existing cachedDefaultMap (already ready)');
      return;
    }
    if (this.#ensurePromise) return this.#ensurePromise;

    this.#ensurePromise = (async () => {
      try {
        if (!this.#cachedDefaultMap) {
          this.#cachedDefaultMap = await this.#createDefaultMapWithRetries(
            retry,
            timeoutMs
          );
        } else {
          postLog('Using existing cachedDefaultMap (populate)');
        }
        this.#vfsReady = true;
        postLog('VFS ensureReady complete');
      } finally {
        this.#ensurePromise = null;
      }
    })();

    return this.#ensurePromise;
  }

  // public: defaultMap を返す(テストや外部参照用)
  getDefaultMap() {
    return this.#cachedDefaultMap;
  }

  // public: デフォルト compilerOptions
  getDefaultCompilerOptions() {
    return {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      allowImportingTsExtensions: true,
      allowArbitraryExtensions: true,
      resolvePackageJsonExports: true,
      resolvePackageJsonImports: true,
      skipLibCheck: true,
      useDefineForClassFields: true,
      noEmit: true,
    };
  }

  // public: VFS 環境を作成して返す
  createEnvironment(compilerOptions = {}, rootFiles = [], initialFiles = {}) {
    if (!this.#cachedDefaultMap) {
      throw new Error('VFS not initialized. Call ensureReady() first.');
    }

    const mapForEnv = this.#mapClone(this.#cachedDefaultMap);
    const normalizedInitialFiles = {};

    for (const [rawKey, content] of Object.entries(initialFiles || {})) {
      try {
        const key = this.#normalizeVfsPath(rawKey);
        const data = String(content ?? '');
        normalizedInitialFiles[key] = data;
        mapForEnv.set(key, data);
        postLog(`createEnvironment: injected initial file: ${key}`);
      } catch (e) {
        postLog(
          `createEnvironment: failed to inject initial file ${rawKey}: ${String(
            e?.message ?? e
          )}`
        );
      }
    }

    const system = vfs.createSystem(mapForEnv);
    const rootPaths = (rootFiles || []).map((r) => this.#normalizeVfsPath(r));
    const defaultOptions = this.getDefaultCompilerOptions();
    const opts = Object.assign({}, defaultOptions, compilerOptions);

    postLog(
      `createEnvironment: about to create env; roots: [${rootPaths.join(
        ', '
      )}], initialFiles: [${Object.keys(normalizedInitialFiles).join(
        ', '
      )}], opts: ${JSON.stringify(opts)}`
    );

    const env = vfs.createVirtualTypeScriptEnvironment(system, rootPaths, ts, opts);
    postLog(`VFS environment created; roots: [${rootPaths.join(', ')}]`);

    // 同期的に内容を反映
    for (const [path, content] of Object.entries(normalizedInitialFiles)) {
      try {
        if (env.getSourceFile && env.getSourceFile(path)) {
          env.updateFile(path, content);
        } else {
          env.createFile(path, content);
        }
      } catch (e) {
        postLog(
          `createEnvironment sync apply failed for ${path}: ${String(e?.message ?? e)}`
        );
      }
    }

    try {
      env.languageService.getProgram();
    } catch (e) {
      postLog(`getProgram() failed after env creation: ${String(e?.message ?? e)}`);
    }

    return env;
  }

  // public: テスト用に状態をリセット
  resetForTest() {
    this.#cachedDefaultMap = null;
    this.#vfsReady = false;
    this.#ensurePromise = null;
    postLog('VfsCore resetForTest() called');
  }

  // public: 現在準備済みか(外部参照用)
  isReady() {
    return !!(this.#vfsReady && this.#cachedDefaultMap);
  }
  static getEnvInfo() {
  return {
    envId: this.#env?.id ?? null,
    defaultMapSize: this.#defaultMap?.size ?? 0,
  };
}
}

// シングルトンインスタンスをエクスポート(既存コード互換のために名前は VfsCore)
export const VfsCore = new VfsCoreClass();

// 旧 API 互換: 関数としても呼べるようにバインドしておく
export const ensureReady = VfsCore.ensureReady.bind(VfsCore);
export const createEnvironment = VfsCore.createEnvironment.bind(VfsCore);
export const resetForTest = VfsCore.resetForTest.bind(VfsCore);
export const getDefaultMap = VfsCore.getDefaultMap.bind(VfsCore);
export const getDefaultCompilerOptions = VfsCore.getDefaultCompilerOptions.bind(VfsCore);
export const isReady = VfsCore.isReady.bind(VfsCore);

