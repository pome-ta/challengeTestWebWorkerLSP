// core/vfs-core.js
// v0.0.2.8 (patch)
// 主な変更: getDefaultCompilerOptions の moduleResolution を NodeJs に変更。createEnvironment に詳細ログ追加。

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

let cachedDefaultMap = null;
let vfsReady = false;
let _ensurePromise = null;

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
      if (msg.includes('fetch') || msg.includes('NetworkError')) {
        postLog(`🚫 Network error while fetching defaultMap: ${msg}`);
        throw error;
      }
      if (msg.includes('timeout')) {
        postLog(`⏰ Timeout on attempt ${attempt}, retrying after backoff`);
        await sleep(1000 * attempt);
        continue;
      }
      postLog(`❌ createDefaultMapWithRetries unknown error: ${msg}`);
      throw error;
    }
  }

  throw lastError || new Error('VFS init failed after retries');
}

function mapClone(src) {
  return new Map(src);
}

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

export function getDefaultMap() {
  return cachedDefaultMap;
}

export function getDefaultCompilerOptions() {
  // ここを NodeJs に変更。相対 import 解決の安定化目的。
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
  };
}

export function createEnvironment(compilerOptions = {}, rootFiles = [], initialFiles = {}) {
  if (!cachedDefaultMap) {
    throw new Error('VFS not initialized. Call ensureReady() first.');
  }

  const mapForEnv = mapClone(cachedDefaultMap);

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

  const system = vfs.createSystem(mapForEnv);

  const rootPaths = (rootFiles || []).map((r) => String(r).replace(/^file:\/\//, ''));

  const defaultOptions = getDefaultCompilerOptions();
  const opts = Object.assign({}, defaultOptions, compilerOptions);

  postLog(`🧠 createEnvironment: about to create env; roots: [${rootPaths.join(', ')}], initialFiles: [${Object.keys(normalizedInitialFiles).join(', ')}], opts: ${JSON.stringify(opts)}`);

  const env = vfs.createVirtualTypeScriptEnvironment(system, rootPaths, ts, opts);
  postLog(`🧠 VFS environment created (via createEnvironment); roots: [${rootPaths.join(', ')}]`);

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

  try {
    env.languageService.getProgram();
  } catch (e) {
    postLog(`⚠️ getProgram() failed right after env creation: ${String(e?.message ?? e)}`);
  }

  return env;
}

export function resetForTest() {
  cachedDefaultMap = null;
  vfsReady = false;
  _ensurePromise = null;
  postLog('♻️ VfsCore resetForTest() called');
}

export const VfsCore = {
  ensureReady,
  isReady: () => vfsReady,
  getDefaultMap,
  createEnvironment,
  getDefaultCompilerOptions,
  resetForTest,
};
