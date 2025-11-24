// core/vfs-core.js
// v0.0.2.6
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
      if (error && error.message && (error.message.includes('fetch') || error.message.includes('NetworkError'))) {
        postLog(`🚫 Network error (give up): ${error.message}`);
        throw error;
      }
      if (error && error.message && error.message.includes('timeout')) {
        postLog(`⏰ Timeout on attempt ${attempt}, retry after backoff`);
        await sleep(1000 * attempt);
        continue;
      }
      postLog(`❌ createDefaultMapWithRetries unknown error: ${error?.message ?? String(error)}`);
      throw error;
    }
  }

  throw lastError || new Error('VFS init failed after retries');
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
        postLog('📦 Using existing cachedDefaultMap');
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
  return {
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
  };
}

/**
 * createEnvironment:
 * - rootFiles: array of absolute paths (like '/file1.ts')
 * - initialFiles: object { '/file1.ts': 'content', '/file2.ts': '...' }
 *
 * Implementation detail:
 * - Clone cachedDefaultMap into new Map
 * - Inject initialFiles into clonedMap BEFORE calling vfs.createSystem(...)
 * - This guarantees system contains those files at environment creation time.
 */
export function createEnvironment(compilerOptions = {}, rootFiles = [], initialFiles = {}) {
  if (!cachedDefaultMap) {
    throw new Error('VFS not initialized. Call ensureReady() first.');
  }

  // 1) clone default map to avoid mutating shared cachedDefaultMap
  const mapClone = new Map(cachedDefaultMap);

  // 2) normalize and inject initialFiles into cloned map (key: absolute path)
  for (const [key, content] of Object.entries(initialFiles || {})) {
    const path = String(key).replace(/^file:\/\//, '');
    // ensure leading slash for stability
    const normalized = path.startsWith('/') ? path : `/${path}`;
    mapClone.set(normalized, String(content));
    postLog(`🧩 createEnvironment: injected initial file into cloned map: ${normalized}`);
  }

  // 3) create system from the cloned map (so system already contains initial files)
  const system = vfs.createSystem(mapClone);

  // 4) normalize root paths and create env
  const rootPaths = (rootFiles || []).map((r) => {
    const p = String(r).replace(/^file:\/\//, '');
    return p.startsWith('/') ? p : `/${p}`;
  });

  const defaultOptions = getDefaultCompilerOptions();
  const opts = Object.assign({}, defaultOptions, compilerOptions);

  const env = vfs.createVirtualTypeScriptEnvironment(system, rootPaths, ts, opts);
  postLog(`🧠 VFS environment created (via createEnvironment); roots: [${rootPaths.join(', ')}]`);

  // 5) After env creation, ensure content is present in env (defensive)
  for (const [key, content] of Object.entries(initialFiles || {})) {
    const path = String(key).replace(/^file:\/\//, '');
    const normalized = path.startsWith('/') ? path : `/${path}`;
    try {
      if (env.getSourceFile && env.getSourceFile(normalized)) {
        env.updateFile(normalized, content);
      } else {
        env.createFile(normalized, content);
      }
    } catch (e) {
      postLog(`⚠️ createEnvironment sync file apply failed for ${normalized}: ${e?.message ?? String(e)}`);
    }
  }

  // 6) prime the language service program
  try {
    env.languageService.getProgram();
  } catch (e) {
    postLog(`⚠️ getProgram() failed right after env creation: ${e?.message ?? String(e)}`);
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
