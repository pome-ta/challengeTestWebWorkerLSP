// test/worker-vfs-multi-file.test.js
// v0.0.1.3

import { expect } from 'chai';
import { createTestWorker } from './test-utils.js';

console.log('🧩 worker-vfs-multi-file.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

(async () => {
  let textContent;

  try {
    const worker = createTestWorker('./js/worker.js');
    worker.postMessage('vfs-multi-file-test');

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No response')), 15000);
      worker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        if (type === 'response' && message?.test === 'vfs-multi-file-test') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    expect(result.before).to.equal(0);
    expect(result.after).to.be.greaterThan(0);

    textContent = `✅ Worker vfs-multi-file-test passed (before:${result.before} → after:${result.after})`;
    console.log(textContent);
  } catch (error) {
    textContent = `❌ Worker vfs-multi-file-test failed: ${error.message}`;
    console.error(textContent);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();