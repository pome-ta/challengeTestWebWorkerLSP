// core/vfs-core.js
// v0.0.2.1


// js/core/vfs-core.js
// v0.0.2

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const postLog = (msg) => self?.postMessage?.({ type: 'log', message: msg });

export async function createDefaultMapWithRetry(retry = 3, timeoutMs = 5000, testDelay=false) {
  let lastErr = null;
  for (let i = 1; i <= retry; i++) {
    postLog(`🔄 VFS init attempt ${i}/${retry}`);
    try {
      // テスト用遅延フラグを受ける場合、外部で testDelay を渡す
      if (testDelay && i === 1) {
        postLog(`♾️ TEST DELAY applied (attempt ${i})`);
        await sleep(15000);
      }

      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), timeoutMs)
      );

      const map = await Promise.race([
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

      postLog(`📦 defaultMap size: ${map.size}`);
      return map;
    } catch (err) {
      lastErr = err;
      if (err.message?.includes('fetch') || err.message?.includes('NetworkError')) {
        postLog(`🚫 Network error: ${err.message}`);
        throw err;
      }
      postLog(`⏰ attempt ${i} failed: ${err.message}`);
      // 緩やかなバックオフ
      await sleep(500 * i);
    }
  }
  throw lastErr || new Error('createDefaultMapWithRetry failed');
}

export function createSystemFromMap(defaultMap) {
  return vfs.createSystem(defaultMap);
}

export function createEnvFromSystem(system, extraCompilerOptions = {}) {
  const compilerOptions = Object.assign(
    {
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowArbitraryExtensions: true,
      allowJs: true,
      checkJs: true,
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
    },
    extraCompilerOptions
  );
  return vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);
}

// ---

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog, sleep } from '../util/logger.js';

export class VfsCore {
  constructor() {
    this.cachedDefaultMap = null;
  }

  async ensureReady() {
    if (this.cachedDefaultMap) return;

    postLog('📦 VFSCore.ensureReady() start');
    this.cachedDefaultMap = await this.createDefaultMapWithRetry();
    postLog('📦 VFS ready');
  }

  async createDefaultMapWithRetry(retry = 3, timeoutMs = 5000) {
    let lastErr;
    for (let i = 1; i <= retry; i++) {
      postLog(`🔄 VFS init attempt ${i}/${retry}`);
      try {
        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), timeoutMs)
        );

        const map = await Promise.race([
          vfs.createDefaultMapFromCDN(
            {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext
            },
            ts.version,
            false,
            ts
          ),
          timeout
        ]);

        return map;
      } catch (err) {
        lastErr = err;
        await sleep(300 * i);
      }
    }

    throw lastErr;
  }

  // ———————————————— v0.0.1 のテスト移植 ——————
  async runUpdateRecheckTest() {
    postLog('💻 vfs-update-recheck-test start');

    const system = vfs.createSystem(this.cachedDefaultMap);
    const compilerOptions = {
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true
    };
    const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);

    const entry = '/main.ts';
    env.createFile(entry, `const x: number = 1;`);

    const before = env.languageService.getSemanticDiagnostics(entry).length;

    env.updateFile(entry, `const x: string = 1;`);

    const after = env.languageService.getSemanticDiagnostics(entry).length;

    return {
      test: 'vfs-update-recheck-test',
      before,
      after,
      status: before === 0 && after > 0 ? 'ok' : 'fail'
    };
  }
}

