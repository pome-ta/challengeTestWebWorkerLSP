// test/v0.0.1/worker-vfs-update-recheck.test.js
// v0.0.1.7

import { expect } from 'chai';
import { createTestWorker, waitForWorkerReady } from './test-utils.js';

console.log('🧩 worker-vfs-update-recheck.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

(async () => {
  let textContent;
  try {
    const worker = createTestWorker('./js/worker.js');

    // Phase 1: 初期化待ち
    await waitForWorkerReady(worker);
    console.log('✅ Worker Initialized');

    // Phase 2: テスト実行
    worker.postMessage('vfs-update-recheck-test');

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No response')), 15000);
      worker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        if (
          type === 'response' &&
          message?.test === 'vfs-update-recheck-test'
        ) {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    expect(result.status).to.equal('ok');
    expect(result.after).to.be.greaterThan(result.before);
    textContent = `✅ Worker vfs-update-recheck-test passed (before:${result.before} → after:${result.after})`;
    console.log(textContent);
  } catch (error) {
    textContent = `❌ Worker vfs-update-recheck-test failed: ${error.message}`;
    console.error(textContent);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
