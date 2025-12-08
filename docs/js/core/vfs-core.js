// core/vfs-core.js
// v0.0.3.2
// - クラス化された VfsCore 実装(プライベートフィールド主体)
// - テスト用に env に一意 ID を付与して保持する仕組みを追加
// - 既存モジュール互換性のために単一インスタンスをエクスポートし、旧 API をバインドして提供

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

class VfsCoreClass {
  // private state
  #cachedDefaultMap = null; // Map<string,string>
  #vfsReady = false;
  #ensurePromise = null;
  #nextEnvId = 0; // createEnvironment で付与する一意 ID のカウンタ
  #lastEnv = null; // 最後に作成(返却)した env を保持(テスト用に参照可能にする)
  #lastRootPaths = []; // lastEnv の rootPaths をキャッシュ(デバッグ/テスト用)

  // パス正規化(file:// を排除し先頭 / を付与)
  #normalizeVfsPath(p) {
    if (!p) return '';
    let s = String(p).replace(/^file:\/\//, '');
    if (!s.startsWith('/')) s = `/${s}`;
    return s;
  }

  // Map の浅いクローン
  #mapClone(src) {
    return new Map(src);
  }

  // CDN から defaultMap を取得する内部ユーティリティ(リトライ付き)
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

  // public: defaultMap が準備されるまで待つ(既存 ensureReady と互換)
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

  // public: 現在の defaultMap を返す(テストや外部参照向け)
  getDefaultMap() {
    return this.#cachedDefaultMap;
  }

  // public: デフォルトの compilerOptions
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

  /**
   * public: VFS 環境を作成して返す
   * - 既存 createEnvironment と互換になるように設計
   * - 返却する env に一意の __vfsId を付与して保持(テストで env の同一性を比較できるようにする)
   */
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

    // env に一意 ID を付与して保持(@typescript/vfs の env にフィールドを付与)
    if (!env.__vfsId) {
      env.__vfsId = ++this.#nextEnvId;
    }
    this.#lastEnv = env;
    this.#lastRootPaths = rootPaths.slice();

    postLog(`VFS environment created; roots: [${rootPaths.join(', ')}] (envId=${env.__vfsId})`);

    // 同期的に初期ファイル内容を反映(createFile/updateFile)
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
    this.#nextEnvId = 0;
    this.#lastEnv = null;
    this.#lastRootPaths = [];
    postLog('VfsCore resetForTest() called');
  }

  // public: 準備済みかどうか
  isReady() {
    return !!(this.#vfsReady && this.#cachedDefaultMap);
  }

  // public: テスト用の env 情報を返す
  getEnvInfo() {
    return {
      envId: this.#lastEnv?.__vfsId ?? null,
      defaultMapSize: this.#cachedDefaultMap?.size ?? 0,
      lastRootPaths: this.#lastRootPaths.slice(),
    };
  }
}

// シングルトンインスタンスをエクスポート(既存コードからの互換のため)
export const VfsCore = new VfsCoreClass();

// 旧 API 互換: 関数としても呼べるようにバインドしておく
export const ensureReady = VfsCore.ensureReady.bind(VfsCore);
export const createEnvironment = VfsCore.createEnvironment.bind(VfsCore);
export const resetForTest = VfsCore.resetForTest.bind(VfsCore);
export const getDefaultMap = VfsCore.getDefaultMap.bind(VfsCore);
export const getDefaultCompilerOptions = VfsCore.getDefaultCompilerOptions.bind(VfsCore);
export const isReady = VfsCore.isReady.bind(VfsCore);
export const getEnvInfo = VfsCore.getEnvInfo.bind(VfsCore);
