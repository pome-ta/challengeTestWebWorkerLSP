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
    // todo: 以下のコードを入れたい

    const defaultMap = await vfs.createDefaultMapFromCDN(
      {
        target: ts.ScriptTarget.ES2022,
      },
      ts.version,
      false,
      ts
    );

    // 軽いテスト用の`setTimeout`
    // todo: `createDefaultMapFromCDN` のときは削除する
    /*
    setTimeout(() => {
      postLog('💻 vfs-init');
      self.postMessage({type: 'response', message: 'return'});
    }, 300);
    */
    postLog('💻 vfs-init');
    self.postMessage({type: 'response', message: 'return'});
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
