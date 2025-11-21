// test/worker-vfs-circular-import.test.js
// v0.0.1.6

import { expect } from 'chai';
import { createTestWorker, waitForWorkerReady } from './test-utils.js';

console.log('🧩 worker-vfs-circular-import.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

(async () => {
  let textContent;
  try {
    const worker = createTestWorker('./js/worker.js');

    await waitForWorkerReady(worker);
    console.log('✅ Worker Initialized');
    worker.postMessage('vfs-circular-import-test');

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No response')), 15000);
      worker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        if (type === 'response' && message?.test === 'vfs-circular-import-test') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    expect(result.status).to.equal('ok');
    expect(result.count).to.be.greaterThan(0);
    textContent = `✅ Worker vfs-circular-import-test passed (${result.count} diagnostics)`;
    console.log(textContent);
  } catch (error) {
    textContent = `❌ Worker vfs-circular-import-test failed: ${error.message}`;
    console.error(textContent);
  }

  
  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
