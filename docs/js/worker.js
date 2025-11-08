// worker.js
// v0.0.0.6

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const DEBUG = true;

const postLog = (message) => {
  DEBUG && self.postMessage({type: 'log', message});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

postLog('👷 worker.js loaded');

async function safeCreateDefaultMap(retryCount = 3) {
  const timeoutMs = 5000; // 各試行あたりのタイムアウト
  let lastError = null;

  for (let i = 0; i < retryCount; i++) {
    postLog(`🔄 VFS init attempt ${i + 1}/${retryCount}`);

    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
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
      if (error.message.includes('fetch') || error.message.includes('NetworkError')) {
        postLog(`🚫 Network error: ${error.message}`);
        throw error; // ネットワーク系は諦める
      } else if (error.message.includes('timeout')) {
        postLog(`⏰ Timeout, retrying...`);
        await sleep(1000 * (i + 1)); // リトライ間隔を少し伸ばす
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

  // 追加:VFS 初期化テスト
  if (data === 'vfs-init') {
    postLog('💻 vfs-init start');

    try {
      const defaultMap = await safeCreateDefaultMap(3);
      // --- Safari 対策 ---
      // postMessage の直後に GC やスレッド切替が入ると落ちる場合があるため、少し遅らせて確実に送信
      setTimeout(() => {
        try {
          self.postMessage({ type: 'response', message: 'return' });
          postLog('📤 vfs-init response sent (delayed)');
        } catch (e) {
          postLog(`⚠️ vfs-init postMessage failed: ${e.message}`);
        }
      }, 50);

    } catch (error) {
      postLog(`❌ vfs-init error: ${error.message}`);
      self.postMessage({ type: 'error', message: error.message });
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
