// core/vfs-core.js
// v0.0.4.2 Phase 10 基盤実装(VFS + TS Language Service-lite)

import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from 'https://esm.sh/@typescript/vfs';

import ts from 'https://esm.sh/typescript';
import { sleep } from '../util/async-utils.js';
import { postLog } from '../util/logger.js';

class VfsCoreClass {
  #env = null;
  #system = null;
  #fsMap = null;
  #initializing = null;
  #ready = false;
  #disposed = false;
  #envId = 0;

  //
  // ---------- public lifecycle ----------
  //

  /**
   * 外部 API:
   *  - 再入可能
   *  - 複数回 await OK
   *  - 1回だけ init を走らせる
   */
  async ensureReady() {
    this.#assertNotDisposed();

    if (this.#ready) {
      return;
    }

    // 二重初期化防止
    if (!this.#initializing) {
      this.#initializing = this.#init();
    }

    await this.#initializing;
  }

  /**
   * 完全破棄
   * - 以後の使用は禁止
   * - strong reference を切る
   */
  dispose() {
    if (this.#disposed) return;

    try {
      this.resetForTest();
    } finally {
      this.#env = null;
      this.#system = null;
      this.#fsMap = null;
      this.#disposed = true;
    }
  }

  /**
   * テスト用リセット
   * - dispose と異なりインスタンス再利用前提
   */
  resetForTest() {
    this.#assertNotDisposed();

    this.#env = null;
    this.#system = null;
    this.#fsMap = null;
    this.#ready = false;
    this.#initializing = null;
    this.#envId = 0;
  }

  /**
   * デバッグ・監視用
   */
  getEnvInfo() {
    return {
      ready: this.#ready,
      disposed: this.#disposed,
      hasEnv: this.#env !== null,
      tsVersion: ts.version,
      envId: this.#envId,
    };
  }

  //
  // ---------- VFS / Document API ----------
  //

  readFile(uri) {
    this.#assertReady();

    return this.#fsMap.get(uri) ?? null;
  }

  writeFile(uri, text) {
    this.#assertReady();

    this.#fsMap.set(uri, text);
    this.#system.writeFile(uri, text);

    // TS 서비스に反映(必須)
    this.#env.updateFile(uri, text);
  }

  /**
   * Language Service の公開
   * Phase 10 の本質
   */
  getLanguageService() {
    this.#assertReady();
    return this.#env.languageService;
  }

  //
  // ---------- internal init ----------
  //

  async #init() {
    this.#envId++;
    postLog(`VfsCore init start (env #${this.#envId})`);

    // 1 lib の CDN 取得
    this.#fsMap = await this.#createDefaultMapWithRetry();

    // 2 system
    this.#system = createSystem(this.#fsMap);

    // 3 env with Language Service
    this.#env = createVirtualTypeScriptEnvironment(
      this.#system,
      [],
      ts,
      {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        allowArbitraryExtensions: true,
        resolvePackageJsonExports: true,
        resolvePackageJsonImports: true,
      }
    );

    this.#ready = true;
    postLog(`VfsCore init complete (env #${this.#envId})`);
  }

  //
  // ---------- CDN fetch with retry ----------
  //

  async #createDefaultMapWithRetry(retryCount = 3, perAttemptTimeoutMs = 7000) {
    let lastError = null;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      postLog(`VFS: lib fetch attempt ${attempt}/${retryCount}`);

      try {
        const result = await Promise.race([
          createDefaultMapFromCDN(
            {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
            },
            ts.version,
            false,
            ts
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), perAttemptTimeoutMs)
          ),
        ]);

        postLog(`VFS: lib fetch success size=${result.size}`);
        return result;

      } catch (err) {
        lastError = err;
        const msg = String(err?.message ?? err);

        if (msg.includes('NetworkError')) {
          postLog(`VFS: network error → abort`);
          throw err;
        }

        if (msg.includes('timeout')) {
          postLog(`VFS: timeout, retry after backoff`);
          await sleep(1000 * attempt);
          continue;
        }

        postLog(`VFS: unexpected error`);
        throw err;
      }
    }

    throw lastError || new Error('VFS default map init failed');
  }

  //
  // ---------- guards ----------
  //

  #assertNotDisposed() {
    if (this.#disposed) {
      throw new Error('VfsCore is already disposed');
    }
  }

  #assertReady() {
    this.#assertNotDisposed();

    if (!this.#ready || !this.#env) {
      throw new Error('VfsCore is not initialized. Call ensureReady() first.');
    }
  }
}

export const VfsCore = new VfsCoreClass();
