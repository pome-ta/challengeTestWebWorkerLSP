// core/vfs-core.js
// v0.0.4.2 Phase 10 決定版: 強いライフサイクル管理 + 閉世界VFS + TS Language Service

import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from 'https://esm.sh/@typescript/vfs';

import ts from 'https://esm.sh/typescript';
import { sleep } from '../util/async-utils.js';
import { postLog } from '../util/logger.js';

class VfsCoreClass {
  //
  // ---------- private state ----------
  //
  #env = null; // VirtualTypeScriptEnvironment
  #system = null; // VFS System
  #fsMap = null; // Map<string,string>
  #initializing = null; // Promise | null
  #ready = false; // boolean
  #disposed = false; // boolean
  #envId = 0; // monotonic counter

  //
  // ---------- public lifecycle ----------
  //

  /**
   * 再入可能・多重 await 安全
   * ただし内部初期化は 1 回のみ
   */
  async ensureReady() {
    this.#assertNotDisposed();

    if (this.#ready) return;

    if (!this.#initializing) {
      this.#initializing = this.#init();
    }

    await this.#initializing;
  }

  /**
   * 完全廃棄
   * 以降の利用は禁止
   */
  dispose() {
    if (this.#disposed) return;

    try {
      // テスト用 reset 手続きも再利用
      this.resetForTest();
    } finally {
      this.#env = null;
      this.#system = null;
      this.#fsMap = null;
      this.#disposed = true;
    }

    postLog('VfsCore disposed');
  }

  /**
   * テスト用リセット
   * dispose と異なり再利用前提
   */
  resetForTest() {
    this.#assertNotDisposed();

    this.#env = null;
    this.#system = null;
    this.#fsMap = null;
    this.#initializing = null;
    this.#ready = false;
    this.#envId = 0;

    postLog('VfsCore resetForTest executed');
  }

  /**
   * デバッグ/監視用
   */
  getEnvInfo() {
    return {
      ready: this.#ready,
      disposed: this.#disposed,
      hasEnv: this.#env !== null,
      envId: this.#envId,
      tsVersion: ts.version,
      fsSize: this.#fsMap?.size ?? 0,
    };
  }

  //
  // ---------- public VFS / Doc API ----------
  //

  readFile(uri) {
    this.#assertReady();
    return this.#fsMap.get(uri) ?? null;
  }

  writeFile(uri, text) {
    this.#assertReady();

    this.#fsMap.set(uri, text);
    this.#system.writeFile(uri, text);

    // TS language service へ反映(必須)
    this.#env.updateFile(uri, text);
  }

  /**
   * Language Service の提供
   * Phase 10 の中核
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

    // 1. lib files from CDN (retry + timeout)
    this.#fsMap = await this.#createDefaultMapWithRetry();

    // 2. virtual system
    this.#system = createSystem(this.#fsMap);

    // 3. environment + language service
    this.#env = createVirtualTypeScriptEnvironment(this.#system, [], ts, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      allowArbitraryExtensions: true,
      resolvePackageJsonExports: false,
      resolvePackageJsonImports: false,
    });

    this.#ready = true;
    postLog(`VfsCore init complete (env #${this.#envId})`);
  }

  //
  // ---------- CDN lib fetch with retry ----------
  //

  async #createDefaultMapWithRetry(retryCount = 3, perAttemptTimeoutMs = 8000) {
    let lastError = null;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      postLog(`VFS lib fetch attempt ${attempt}/${retryCount}`);

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

        postLog(`VFS lib fetch success size=${result.size}`);
        return result;
      } catch (err) {
        lastError = err;
        const msg = String(err?.message ?? err);

        // hard-fail on network-level errors
        if (msg.includes('NetworkError')) {
          postLog('VFS lib fetch network error → abort');
          throw err;
        }

        // timed out → retry with backoff
        if (msg.includes('timeout')) {
          postLog('VFS lib fetch timeout → retry with backoff');
          await sleep(1000 * attempt);
          continue;
        }

        // unexpected error
        postLog('VFS lib fetch unexpected error → abort');
        throw err;
      }
    }

    throw lastError || new Error('VFS default map initialization failed');
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
