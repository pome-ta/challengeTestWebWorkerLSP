// test/worker-ping.test.js
// v0.0.0.2

import {expect} from 'chai';
import {createTestWorker} from './test-utils.js';

console.log('🧩 worker-ping.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

let textContent;

// --- テスト開始 ---
(async () => {
  try {
    const worker = new Worker('./js/worker.js', {type: 'module'});

    // Worker の初期化完了を待機
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Worker not ready')),
        2000
      );
      worker.onmessage = (event) => {
        if (event.data === 'ready') {
          clearTimeout(timer);
          resolve();
        }
      };
    });

    // --- ping テスト ---
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('No pong response')),
        2000
      );

      worker.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data);
      };

      worker.postMessage('ping');
    });

    // Worker からの応答を確認(まだ失敗する想定)
    expect(response).to.equal('pong');
    textContent = '✅ Worker ping test passed';
    console.log('✅ Worker ping test passed');
  } catch (error) {
    textContent = `❌ Worker ping test failed: ${error.message}`;
    console.error(`❌ Worker ping test failed: ${error}`);
  }
  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
