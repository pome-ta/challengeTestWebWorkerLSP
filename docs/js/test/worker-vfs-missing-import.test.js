// test/worker-vfs-missing-import.test.js
// v0.0.1.5

import { expect } from 'chai';
import { createTestWorker, waitForWorkerReady } from './test-utils.js';

console.log('🧩 worker-vfs-missing-import.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

(async () => {
  let textContent;
  try {
    const worker = createTestWorker('./js/worker.js');
    
    await waitForWorkerReady(worker);
    console.log('✅ Worker Initialized');
    
    worker.postMessage('vfs-missing-import-test');

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No response')), 15000);
      worker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        if (type === 'response' && message?.test === 'vfs-missing-import-test') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    expect(result.status).to.equal('ok');
    expect(result.diagnostics[0]).to.include('Cannot find module');

    textContent = `✅ Worker vfs-missing-import-test passed (${result.diagnostics.length} errors)`;
    console.log(textContent);
  } catch (error) {
    textContent = `❌ Worker vfs-missing-import-test failed: ${error.message}`;
    console.error(textContent);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
