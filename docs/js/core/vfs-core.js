// core/vfs-core.js
// v0.0.3.4 → v0.0.3.5（dispose 追加）

import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

class VfsCoreClass {
  #env = null;
  #system = null;
  #fsMap = null;
  #ready = false;
  #initializing = null;
  #envId = 0;

  async #createDefaultMapWithRetry(retryCount = 3, perAttemptTimeoutMs = 5000) {
    let lastError = null;
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      postLog(`VFS init attempt ${attempt}/${retryCount}`);
      try {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), perAttemptTimeoutMs)
        );

        const defaultMap = await Promise.race([
          createDefaultMapFromCDN(
            {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
            },
            ts.version,
            false,
            ts
          ),
          timeout
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

  async ensureReady() {
    if (this.#ready) return;

    if (!this.#initializing) {
      this.#initializing = this.#init();
    }

    await this.#initializing;
  }

  async #init() {
    this.#envId++;

    this.#fsMap = await this.#createDefaultMapWithRetry();
    this.#system = createSystem(this.#fsMap);

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
      }
    );

    this.#ready = true;
  }

  getEnvInfo() {
    return {
      ready: this.#ready,
      hasEnv: this.#env !== null,
      tsVersion: ts.version,
      envId: this.#envId,
    };
  }

  readFile(uri) {
    if (!this.#ready) return null;
    return this.#env.sys.readFile(uri) ?? null;
  }

  writeFile(uri, text) {
    if (!this.#ready) {
      throw new Error('VFS not initialized');
    }
    this.#env.updateFile(uri, text);
  }

  getLanguageService() {
    if (!this.#ready || !this.#env) return null;
    return this.#env.languageService;
  }

  resetForTest() {
    this.#env = null;
    this.#system = null;
    this.#fsMap = null;
    this.#ready = false;
    this.#initializing = null;
    this.#envId = 0;
  }

  // ★★★ 追加箇所 ★★★
  // 本番用ライフサイクル管理 API
  // worker shutdown / project unload を想定
  dispose() {
    postLog('VFS dispose called');

    // env の内部構造を GC 対象にする
    this.#env = null;
    this.#system = null;
    this.#fsMap = null;

    // future re-init 可能状態へ戻す
    this.#ready = false;
    this.#initializing = null;
  }
}

export const VfsCore = new VfsCoreClass();