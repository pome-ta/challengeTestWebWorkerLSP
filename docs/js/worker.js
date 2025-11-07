// worker.js
// v0.0.0.5

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const DEBUG = true;

const postLog = (message) => {
  DEBUG && self.postMessage({type: 'log', message});
};

postLog('👷 worker.js loaded');

self.addEventListener('message', async (event) => {
  const {data} = event;

  // 追加:VFS 初期化テスト
  if (data === 'vfs-init') {
    postLog('💻 vfs-init start');

    try {
      const defaultMap = await vfs.createDefaultMapFromCDN(
        { target: ts.ScriptTarget.ES2022 },
        ts.version,
        false,
        ts
      );

      postLog(`📦 defaultMap size: ${defaultMap.size}`);

      // --- Safari 対策 ---
      // postMessage の直後に GC やスレッド切替が入ると落ちる場合があるため
      // 少し遅らせて確実に送信
      setTimeout(() => {
        try {
          self.postMessage({ type: 'response', message: 'return' });
          postLog('📤 vfs-init response sent (delayed)');
        } catch (e) {
          postLog(`⚠️ vfs-init postMessage failed: ${e.message}`);
        }
      }, 50);
      // ---------------------

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
