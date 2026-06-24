// core/vfs-core.js
// v0.0.4.2 ?

import * as ts from 'https://esm.sh/typescript';
import {
  createDefaultMapFromCDN,
  createVirtualTypeScriptEnvironment,
} from 'https://esm.sh/@typescript/vfs';

import { sleep } from '../util/async-utils.js';
import { postLog } from '../util/logger.js';

class VfsCore {
  constructor() {
    postLog('VFS constructor');
    this.ready = false;
    this.env = null;
    this.fsMap = null;
  }

  async ensureReady() {
    if (this.ready) return;

    postLog('VFS ensureReady start');

    // CDN lib map fetch（リトライ付き）
    this.fsMap = await this.#createDefaultMapWithRetry();

    postLog('VFS default lib map ready');

    this.env = createVirtualTypeScriptEnvironment(
      { ...ts.sys, readFile: (p) => this.fsMap.get(p) || '' },
      [],
      ts,
      this.fsMap
    );

    this.ready = true;
    postLog('VFS ensureReady complete');
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

        if (msg.includes('NetworkError')) {
          postLog('VFS lib fetch network error → abort');
          throw err;
        }

        if (msg.includes('timeout')) {
          postLog('VFS lib fetch timeout → retry with backoff');
          await sleep(1000 * attempt);
          continue;
        }

        postLog('VFS lib fetch unexpected error → abort');
        throw err;
      }
    }

    throw lastError || new Error('VFS default map initialization failed');
  }

  writeFile(fileName, content) {
    if (!this.ready) throw new Error('VFS not ready');
    this.fsMap.set(fileName, content);
  }

  getSourceFile(fileName) {
    if (!this.ready) throw new Error('VFS not ready');
    return this.env.program.getSourceFile(fileName);
  }

  getLanguageService() {
    if (!this.ready) throw new Error('VFS not ready');
    return this.env.languageService;
  }
}

export const VfsCoreInstance = new VfsCore();