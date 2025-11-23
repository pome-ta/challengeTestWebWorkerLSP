// test/v0.0.1/worker-vfs-init.test.js
// v0.0.0.6

import { expect } from 'chai';
import { createTestWorker, waitForWorkerReady } from './test-utils.js';

console.log('🧩 worker-vfs-init.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

let textContent;

// --- テスト開始 ---
(async () => {
  try {
    const worker = createTestWorker('../../js/worker.js');

    await waitForWorkerReady(worker);
    console.log('✅ Worker Initialized');

    worker.postMessage('vfs-init');

    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('No vfs-init response')),
        15000
      );
      worker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        if (type === 'response') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    expect(message).to.equal('return');
    textContent = '✅ Worker vfs-init test passed';
    console.log(textContent);
  } catch (error) {
    textContent = `❌ Worker vfs-init test failed: ${error.message}`;
    console.error(`❌ Worker vfs-init test failed: ${error}`);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
