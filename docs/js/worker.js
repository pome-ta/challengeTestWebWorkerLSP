// worker.js
// v0.0.1.1

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const DEBUG = true;

const postLog = (message) => {
  DEBUG && self.postMessage({type: 'log', message});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

postLog('👷 worker.js loaded');

async function safeCreateDefaultMap(
  retryCount = 3,
  perAttemptTimeoutMs = 5000
) {
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
      return defaultMap; // 成功したら返す
    } catch (error) {
      lastError = error;
      if (
        error.message.includes('fetch') ||
        error.message.includes('NetworkError')
      ) {
        postLog(`🚫 Network error: ${error.message}`);
        throw error; // ネットワーク系は諦める
      } else if (error.message.includes('timeout')) {
        postLog(`⏰ Timeout, retrying...`);
        await sleep(1000 * attempt); // リトライ間隔を少し伸ばす
        continue;
      } else {
        postLog(`❌ Unknown error: ${error.message}`);
        throw error;
      }
    }
  }

  throw lastError || new Error('VFS init failed after retries');
}

self.addEventListener('message', async (event) => {
  const {data} = event;
  
  
  if (data === 'vfs-env-test') {
    postLog('💻 vfs-env-test start');
    try {
      const defaultMap = await safeCreateDefaultMap(3);

      const system = vfs.createSystem(defaultMap);
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowArbitraryExtensions: true,
        allowJs: true,
        checkJs: true,
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
      };
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);

      postLog(`🧠 env created. env: ${env}`);

      // テスト結果を返す
      self.postMessage({
        type: 'response',
        message: {
          status: 'ok',
        },
      });
    } catch (error) {
      postLog(`❌ vfs-env-test error: ${error.message}`);
      self.postMessage({ type: 'error', message: error.message });
    }
  }


  if (data === 'vfs-init') {
    postLog('💻 vfs-init start');

    try {
      const defaultMap = await safeCreateDefaultMap(3);
      // Safari 対策: postMessage 直後の GC 回避
      setTimeout(() => {
        try {
          self.postMessage({type: 'response', message: 'return'});
          postLog('📤 vfs-init response sent (delayed)');
        } catch (error) {
          postLog(`⚠️ vfs-init postMessage failed: ${error.message}`);
        }
      }, 50);
    } catch (error) {
      postLog(`❌ vfs-init error: ${error.message}`);
      self.postMessage({type: 'error', message: error.message});
    }
  }

  if (data === 'ping') {
    postLog('📡 Received: ping');
    self.postMessage({type: 'response', message: 'pong'});
  }

  if (data === 'shutdown') {
    postLog('👋 Worker shutting down...');
    self.postMessage({type: 'response', message: 'shutdown-complete'});
    // ログ送信を少し待つ
    setTimeout(() => self.close(), 100);
  }
});

// ready 通知
self.postMessage({type: 'ready'});
