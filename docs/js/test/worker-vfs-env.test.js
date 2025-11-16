// test/worker-vfs-env.test.js
// v0.0.1.1

import { expect } from 'chai';
import { createTestWorker } from './test-utils.js';

console.log('🧩 worker-vfs-env.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

(async () => {
  let textContent;
  try {
    const worker = createTestWorker('./js/worker.js');
    worker.postMessage('vfs-env-test');

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No response')), 15000);
      worker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        if (type === 'response' && message?.status === 'ok') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    expect(result.status).to.equal('ok');
    expect(result.diagnosticsCount).to.be.greaterThan(0);

    textContent = `✅ Worker vfs-env-test passed response:${result.status}`;
    console.log(textContent);
  } catch (error) {
    textContent = `❌ Worker vfs-env-test failed: ${error.message}`;
    console.error(textContent);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
