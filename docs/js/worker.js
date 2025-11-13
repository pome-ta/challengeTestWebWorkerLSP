// worker.js
// v0.0.2.0
//
// Entrypoint worker: dispatches messages to core modules.
// Keeps previous test-compatible logging interface: postLog(msg).
//
// Exports nothing; executed as worker module.

import * as vfsCore from './core/vfs-core.js';
import * as lspCore from './core/lsp-core.js';

const DEBUG = true;
const postLog = (msg) => {
  if (DEBUG) {
    // structured message for main-side test utils
    try {
      self.postMessage({ type: 'log', message: `${msg}` });
    } catch (e) {
      // best-effort
      console.error('[worker] postLog failed', e, msg);
    }
  }
};

const safeHandlerCall = async (fn, args = [], timeoutMs = 0) => {
  if (timeoutMs > 0) {
    return Promise.race([fn(...args), new Promise((_, rej) => setTimeout(() => rej(new Error('handler timeout')), timeoutMs))]);
  } else {
    return fn(...args);
  }
};

self.addEventListener('message', async (ev) => {
  const data = ev.data;
  try {
    // simple string commands (keeps compatibility with existing tests)
    if (typeof data === 'string') {
      switch (data) {
        case 'vfs-init': {
          postLog('💻 vfs-init start');
          try {
            const meta = await vfsCore.runVfsInit((m) => postLog(m));
            // delay slightly for Safari GC race observed previously
            setTimeout(() => {
              self.postMessage({ type: 'response', message: 'return', meta });
              postLog('📤 vfs-init response sent (delayed)');
            }, 50);
          } catch (err) {
            postLog(`❌ vfs-init error: ${err.message}`);
            self.postMessage({ type: 'error', message: err.message });
          }
          return;
        }
        case 'ping': {
          postLog('📡 Received: ping');
          self.postMessage({ type: 'response', message: 'pong' });
          return;
        }
        case 'shutdown': {
          postLog('👋 Worker shutting down...');
          self.postMessage({ type: 'response', message: 'shutdown-complete' });
          // small grace for logs to flush
          setTimeout(() => self.close(), 100);
          return;
        }
        // VFS test commands (mirror previous behavior)
        case 'vfs-file-test': {
          postLog('💻 vfs-file-test start');
          try {
            const res = await vfsCore.runFileTest((m) => postLog(m));
            self.postMessage({ type: 'response', message: res });
            postLog('📤 vfs-file-test response sent');
          } catch (err) {
            postLog(`❌ vfs-file-test error: ${err.message}`);
            self.postMessage({ type: 'error', message: err.message });
          }
          return;
        }
        case 'vfs-update-recheck-test': {
          postLog('💻 vfs-update-recheck-test start');
          try {
            const res = await vfsCore.runUpdateRecheckTest((m) => postLog(m));
            self.postMessage({ type: 'response', message: res });
            postLog('📤 vfs-update-recheck-test response sent');
          } catch (err) {
            postLog(`❌ vfs-update-recheck-test error: ${err.message}`);
            self.postMessage({ type: 'error', message: err.message });
          }
          return;
        }
        case 'vfs-multi-file-test': {
          postLog('💻 vfs-multi-file-test start');
          try {
            const res = await vfsCore.runMultiFileTest((m) => postLog(m));
            self.postMessage({ type: 'response', message: res });
            postLog('📤 vfs-multi-file-test response sent');
          } catch (err) {
            postLog(`❌ vfs-multi-file-test error: ${err.message}`);
            self.postMessage({ type: 'error', message: err.message });
          }
          return;
        }
        case 'vfs-delete-test': {
          postLog('💻 vfs-delete-test start');
          try {
            const res = await vfsCore.runDeleteTest((m) => postLog(m));
            self.postMessage({ type: 'response', message: res });
            postLog('📤 vfs-delete-test response sent');
          } catch (err) {
            postLog(`❌ vfs-delete-test error: ${err.message}`);
            self.postMessage({ type: 'error', message: err.message });
          }
          return;
        }
        case 'vfs-missing-import-test': {
          postLog('💻 vfs-missing-import-test start');
          try {
            const res = await vfsCore.runMissingImportTest((m) => postLog(m));
            self.postMessage({ type: 'response', message: res });
            postLog('📤 vfs-missing-import-test response sent');
          } catch (err) {
            postLog(`❌ vfs-missing-import-test error: ${err.message}`);
            self.postMessage({ type: 'error', message: err.message });
          }
          return;
        }
        case 'vfs-circular-import-test': {
          postLog('💻 vfs-circular-import-test start');
          try {
            const res = await vfsCore.runCircularImportTest((m) => postLog(m));
            self.postMessage({ type: 'response', message: res });
            postLog('📤 vfs-circular-import-test response sent');
          } catch (err) {
            postLog(`❌ vfs-circular-import-test error: ${err.message}`);
            self.postMessage({ type: 'error', message: err.message });
          }
          return;
        }
        case 'vfs-env-test': {
          postLog('💻 vfs-env-test start');
          try {
            const defaultMap = await vfsCore.safeCreateDefaultMap((m) => postLog(m));
            const { env } = vfsCore.createEnv(defaultMap, self.ts ?? undefined, {}); // ts injection not used here, kept for symmetry
            postLog(`🧠 env created`);
            // small info returned
            self.postMessage({ type: 'response', message: { status: 'ok' } });
          } catch (err) {
            postLog(`❌ vfs-env-test error: ${err.message}`);
            self.postMessage({ type: 'error', message: err.message });
          }
          return;
        }
        default:
          // unknown string - ignore
          return;
      }
    }

    // If data is object (possible RPC shape), handle lightweight LSP lifecycle calls
    if (data && typeof data === 'object' && data.method) {
      const { method, params, id } = data;
      // simple mapping
      try {
        switch (method) {
          case 'initialize': {
            const result = await safeHandlerCall(lspCore.initialize, [params ?? {}, (m)=>postLog(m)]);
            if (id !== undefined) self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
            return;
          }
          case 'initialized': {
            await lspCore.initialized(params ?? {}, (m)=>postLog(m));
            // notification -> no response
            return;
          }
          case 'shutdown': {
            const result = await lspCore.shutdown(params ?? {}, (m)=>postLog(m));
            if (id !== undefined) self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
            return;
          }
          case 'ping': {
            const result = await lspCore.ping(params ?? {}, (m)=>postLog(m));
            if (id !== undefined) self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
            return;
          }
          default: {
            postLog(`❓ unknown RPC method: ${method}`);
            if (id !== undefined) {
              self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }));
            }
            return;
          }
        }
      } catch (err) {
        if (id !== undefined) {
          self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: String(err?.message ?? err) } }));
        } else {
          postLog(`❌ handler error: ${err?.message ?? err}`);
        }
        return;
      }
    }
  } catch (err) {
    postLog(`❌ worker top-level handler error: ${String(err?.message ?? err)}`);
  }
});

// ready notification (keeps compatibility with test harness)
self.postMessage({ type: 'ready' });
