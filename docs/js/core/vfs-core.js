// core/vfs-core.js
// v0.0.4.2 Phase 10: VFS closed-world + TS Language Service-lite

import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from 'https://esm.sh/@typescript/vfs';

import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

class VfsCoreClass {
  #env = null;              // { languageService, program, ... }
  #system = null;           // virtual System
  #fsMap = null;            // Map<string,string>
  #ready = false;
  #initializing = null;
  #envId = 0;

  // ----------------------------------------
  // internal utility
  // ----------------------------------------
  async #loadDefaultLibsWithRetry(retryCount = 3, perAttemptTimeoutMs = 7000) {
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
              strict: true,
              skipLibCheck: true,
              noEmit: true,
            },
            ts.version,
            false,
            ts
          ),
          timeout,
        ]);

        postLog(`defaultMap size: ${defaultMap.size}`);
        return defaultMap;
      } catch (err) {
        lastError = err;
        const msg = String(err?.message ?? err);

        if (msg.includes('timeout')) {
          postLog(`timeout, backoff retry...`);
          await sleep(800 * attempt);
          continue;
        }

        if (msg.includes('fetch') || msg.includes('NetworkError')) {
          postLog(`network failure during lib fetch: ${msg}`);
          throw err;
        }

        throw err;
      }
    }

    throw lastError || new Error('failed to init vfs after retries');
  }

  // ----------------------------------------
  // initialization
  // ----------------------------------------
  async ensureReady() {
    if (this.#ready) return;

    if (!this.#initializing) {
      this.#initializing = this.#init();
    }

    await this.#initializing;
  }

  async #init() {
    this.#envId++;

    // 1) load stdlib files from CDN
    this.#fsMap = await this.#loadDefaultLibsWithRetry();

    // 2) create virtual System
    this.#system = createSystem(this.#fsMap);

    // 3) create Virtual TypeScript Environment
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

    postLog(`VFS ready. envId=${this.#envId}`);
  }

  // ----------------------------------------
  // file operations
  // ----------------------------------------
  writeFile(uri, text) {
    if (!this.#ready) {
      throw new Error('VFS not ready');
    }

    this.#fsMap.set(uri, text);
    this.#system.writeFile(uri, text);

    // languageService side is incremental-aware
    this.#env.updateFile(uri, text);
  }

  readFile(uri) {
    if (!this.#ready) {
      throw new Error('VFS not ready');
    }
    return this.#fsMap.get(uri) ?? null;
  }

  // ----------------------------------------
  // language service access
  // ----------------------------------------
  getLanguageService() {
    if (!this.#ready) {
      throw new Error('VFS not ready');
    }
    return this.#env.languageService;
  }

  // ----------------------------------------
  // observability / debug
  // ----------------------------------------
  getEnvInfo() {
    return {
      ready: this.#ready,
      envId: this.#envId,
      tsVersion: ts.version,
      fileCount: this.#fsMap?.size ?? 0,
    };
  }

  // ----------------------------------------
  // test support
  // ----------------------------------------
  resetForTest() {
    this.#env = null;
    this.#system = null;
    this.#fsMap = null;
    this.#ready = false;
    this.#initializing = null;
    this.#envId = 0;
  }
}

export const VfsCore = new VfsCoreClass();
