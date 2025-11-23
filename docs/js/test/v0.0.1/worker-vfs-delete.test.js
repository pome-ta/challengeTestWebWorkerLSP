// test/v0.0.1/worker-vfs-delete.test.js
// v0.0.1.4

import { expect } from 'chai';
import { createTestWorker, waitForWorkerReady } from './test-utils.js';

console.log('🧩 worker-vfs-delete.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

(async () => {
  let textContent;
  try {
    const worker = createTestWorker('../../js/worker.js');

    await waitForWorkerReady(worker);
    console.log('✅ Worker Initialized');
    worker.postMessage('vfs-delete-test');

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No response')), 15000);
      worker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        if (type === 'response' && message?.test === 'vfs-delete-test') {
          clearTimeout(timer);
          resolve(message);
        }

        if (type === 'error') {
          clearTimeout(timer);
          reject(new Error(message || 'worker error'));
        }
      });
    });

    // --- 検証内容 ---
    expect(result.before).to.equal(0);
    expect(result.after).to.be.greaterThan(0);
    expect(result.errorCode).to.equal('TS2307');

    textContent = `✅ Worker vfs-delete-test passed (before:${result.before} → after:${result.after})`;
    console.log(textContent);
  } catch (error) {
    textContent = `❌ Worker vfs-delete-test failed: ${error.message}`;
    console.error(textContent);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
