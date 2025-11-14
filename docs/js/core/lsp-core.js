// core/lsp-core.js
// v0.0.2.0-core-lsp
//
// Minimal LSP lifecycle handlers.
// Exports initialize/initialized/shutdown/ping that can be called from worker dispatcher.
// These are thin wrappers for now (stateful placeholder object kept inside the module).
//
// Each method accepts params and a logger callback.

let _state = {
  initialized: false,
  capabilities: null,
};

export const initialize = async (params = {}, logger = () => {}) => {
  logger(`🔧 initialize called`);
  // accept initializationOptions if present
  const initializationOptions = params.initializationOptions ?? params?.capabilities ?? {};
  _state.capabilities = {
    textDocumentSync: 1,
    completionProvider: { resolveProvider: true },
    ...initializationOptions,
  };
  _state.initialized = true; // mark as initialized for now
  return {
    capabilities: _state.capabilities,
    serverInfo: { name: 'ts-vfs-worker', version: 'v0.0.2.0' },
  };
};

export const initialized = async (params = {}, logger = () => {}) => {
  logger('🔔 client reported initialized');
  _state.initialized = true;
};

export const shutdown = async (params = {}, logger = () => {}) => {
  logger('🛑 shutdown called');
  _state.initialized = false;
  // return a minimal object to satisfy worker-client expectation
  return { success: true };
};

export const ping = async (params = {}, logger = () => {}) => {
  logger('📡 ping');
  return { echoed: params?.msg ?? '(no message)' };
};