// core/lsp-core.js
// v0.0.2.1


import { postLog } from '../util/logger.js';

export class LspCore {
  constructor() {
    this.initialized = false;
  }

  handleInitialize() {
    postLog('🔧 LspCore.initialize()');
    this.initialized = true;

    // ここで LSP initialize response に近い形を返す
    return {
      capabilities: {},
      serverInfo: {
        name: 'mini-lsp',
        version: '0.0.2.0'
      }
    };
  }

  handleShutdown() {
    postLog('🔧 LspCore.shutdown()');
    this.initialized = false;
    return true;
  }

  handlePing() {
    return 'pong';
  }
}

/*

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
}*/
