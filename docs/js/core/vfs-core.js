// core/vfs-core.js
// v0.0.2.7
// This version provides:
// - Stable compiler options for NodeJs/NodeNext import resolution
// - Unified normalization for all paths
// - Injection-safe VFS map construction
// - Allowing '.ts' extension imports (TS5097 fix)
// - Robust environment recreation flow
// - Stronger logging for debugging multi-file behavior

import * as vfs from "https://esm.sh/@typescript/vfs";
import ts from "https://esm.sh/typescript";
import { postLog } from "../util/logger.js";
import { sleep } from "../util/async-utils.js";

// -------------------------------------------------------
// Global VFS State
// -------------------------------------------------------
let cachedDefaultMap = null;
let vfsReady = false;
let _ensurePromise = null;

// -------------------------------------------------------
// Normalize VFS path: strip file:// and ensure leading "/"
// -------------------------------------------------------
function normalizeVfsPath(p) {
  if (!p) return "";
  let s = String(p).replace(/^file:\/\//, "");
  if (!s.startsWith("/")) s = `/${s}`;
  return s;
}

// -------------------------------------------------------
// Clone MAP
// -------------------------------------------------------
function mapClone(src) {
  return new Map(src);
}

// -------------------------------------------------------
// Robust DefaultMap fetch (with timeout + retry)
// -------------------------------------------------------
async function createDefaultMapWithRetries(retryCount = 3, perAttemptTimeoutMs = 5000) {
  let lastError = null;

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    postLog(`🔄 VFS init attempt ${attempt}/${retryCount}`);

    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), perAttemptTimeoutMs)
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
        timeout
      ]);

      postLog(`📦 defaultMap size: ${defaultMap.size}`);
      return defaultMap;

    } catch (error) {
      lastError = error;
      const msg = String(error?.message ?? error);

      if (msg.includes("fetch") || msg.includes("NetworkError")) {
        postLog(`🚫 Network error while fetching defaultMap: ${msg}`);
        throw error;
      }
      if (msg.includes("timeout")) {
        postLog(`⏰ Timeout on attempt ${attempt}, retrying after backoff`);
        await sleep(1000 * attempt);
        continue;
      }

      postLog(`❌ createDefaultMapWithRetries unknown error: ${msg}`);
      throw error;
    }
  }

  throw lastError || new Error("VFS init failed after retries");
}

// -------------------------------------------------------
// Public: ensureReady()
// -------------------------------------------------------
export async function ensureReady(retry = 3, timeoutMs = 5000) {
  if (vfsReady && cachedDefaultMap) {
    postLog("📦 Using existing cachedDefaultMap (already ready)");
    return;
  }
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    try {
      if (!cachedDefaultMap) {
        cachedDefaultMap = await createDefaultMapWithRetries(retry, timeoutMs);
      } else {
        postLog("📦 Using existing cachedDefaultMap (populate)");
      }
      vfsReady = true;
      postLog("✅ VFS ensureReady complete");

    } finally {
      _ensurePromise = null;
    }
  })();

  return _ensurePromise;
}

// -------------------------------------------------------
// Public: getDefaultMap()
// -------------------------------------------------------
export function getDefaultMap() {
  return cachedDefaultMap;
}

// -------------------------------------------------------
// Public: Compiler Options (robust NodeJs resolution)
// -------------------------------------------------------
export function getDefaultCompilerOptions() {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,

    // [CHANGE] NodeJs resolution is correct for CDN-based stdlib map
    moduleResolution: ts.ModuleResolutionKind.NodeJs,

    strict: true,

    // [CHANGE] Required for resolving .ts explicit import (fixes TS5097)
    allowImportingTsExtensions: true,

    // [CHANGE] Recommended for NodeNext/NodeJs in VFS
    allowArbitraryExtensions: true,

    // [CHANGE] Recommended for bare specifier resolution
    resolvePackageJsonExports: true,
    resolvePackageJsonImports: true,

    // [CHANGE] Needed for createVirtualTS env in browsers
    skipLibCheck: true,
    useDefineForClassFields: true
  };
}

// -------------------------------------------------------
// Public: createEnvironment()
// -------------------------------------------------------
export function createEnvironment(compilerOptions = {}, rootFiles = [], initialFiles = {}) {
  if (!cachedDefaultMap) {
    throw new Error("VFS not initialized. Call ensureReady() first.");
  }

  // A. Clone default map
  const mapForEnv = mapClone(cachedDefaultMap);

  // B. Normalize and inject initial files into map
  const normalizedInitialFiles = {};
  for (const [rawKey, content] of Object.entries(initialFiles || {})) {
    const key = normalizeVfsPath(rawKey);
    const data = String(content ?? "");

    normalizedInitialFiles[key] = data;
    mapForEnv.set(key, data);

    postLog(`🧩 createEnvironment: injected initial file: ${key}`);
  }

  // C. Prepare virtual FS
  const system = vfs.createSystem(mapForEnv);

  // D. Normalize rootPaths
  const rootPaths = (rootFiles || []).map((r) => normalizeVfsPath(r));

  // E. Compose compiler options
  const defaultOptions = getDefaultCompilerOptions();
  const opts = Object.assign({}, defaultOptions, compilerOptions);

  postLog(
    `🧠 createEnvironment: about to create env; roots: [${rootPaths.join(
      ", "
    )}], initialFiles: [${Object.keys(normalizedInitialFiles).join(
      ", "
    )}], opts: ${JSON.stringify(opts)}`
  );

  // F. Create Virtual TS Environment
  const env = vfs.createVirtualTypeScriptEnvironment(system, rootPaths, ts, opts);

  postLog(
    `🧠 VFS environment created (via createEnvironment); roots: [${rootPaths.join(
      ", "
    )}]`
  );

  // G. Ensure sync-injection into TS env
  for (const [path, content] of Object.entries(normalizedInitialFiles)) {
    try {
      const sf = env.getSourceFile(path);
      if (sf) env.updateFile(path, content);
      else env.createFile(path, content);
    } catch (e) {
      postLog(`⚠️ createEnvironment sync apply failed: ${path}: ${String(e?.message ?? e)}`);
    }
  }

  // H. Pre-warm language service
  try {
    env.languageService.getProgram();
  } catch (e) {
    postLog(`⚠️ getProgram() failed after env creation: ${String(e?.message ?? e)}`);
  }

  return env;
}

// -------------------------------------------------------
// Public: resetForTest()
// -------------------------------------------------------
export function resetForTest() {
  cachedDefaultMap = null;
  vfsReady = false;
  _ensurePromise = null;

  postLog("♻️ VfsCore resetForTest() called");
}

// -------------------------------------------------------
// Public API
// -------------------------------------------------------
export const VfsCore = {
  ensureReady,
  isReady: () => vfsReady,
  getDefaultMap,
  createEnvironment,
  getDefaultCompilerOptions,
  resetForTest
};
