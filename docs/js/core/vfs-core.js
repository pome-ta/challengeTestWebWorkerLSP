// core/vfs-core.js
// v0.0.3.4

//import * as vfs from 'https://esm.sh/@typescript/vfs';
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
  #ready = false;
  #initializing = null;
  #envId = 0;

  // CDN から defaultMap を取得する内部ユーティリティ(リトライ付き)
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

  async ensureReady() {
    if (this.#ready) {
      return;
    }

    if (!this.#initializing) {
      this.#initializing = this.#init();
    }

    await this.#initializing;
  }

  async #init() {
    this.#envId++;

    const fsMap = await this.#createDefaultMapWithRetry();
    const system = createSystem(fsMap);
    this.#env = createVirtualTypeScriptEnvironment(system, [], ts, {
      target: ts.ScriptTarget.ESNext,
    });

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

  resetForTest() {
    this.#env = null;
    this.#ready = false;
    this.#initializing = null;
    this.#envId = 0;
  }
}

export const VfsCore = new VfsCoreClass();
