// core/lsp-core.js
// v0.0.2.1


import * as vfsCore from './vfs-core.js';

let cachedDefaultMap = null;
let initialized = false;

export async function initialize({ retry = 3, timeoutMs = 5000, testDelay = false } = {}) {
  if (initialized && cachedDefaultMap) {
    return { status: 'ok', cached: true };
  }
  try {
    cachedDefaultMap = await vfsCore.createDefaultMapWithRetry(retry, timeoutMs, testDelay);
    initialized = true;
    return { status: 'ok' };
  } catch (err) {
    initialized = false;
    cachedDefaultMap = null;
    throw err;
  }
}

export function isInitialized() {
  return initialized && !!cachedDefaultMap;
}

export function getCachedDefaultMap() {
  if (!isInitialized()) throw new Error('Not initialized');
  return cachedDefaultMap;
}
