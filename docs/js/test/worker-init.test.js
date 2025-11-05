// test/worker-init.test.js
// v0.0.0.1

import { expect } from 'chai';
import { createTestWorker } from './test-runner.js';

console.log('🧩 worker-init.test.js loaded');

const results = document.getElementById('results');
const orederedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

let textContent;

// --- テスト開始 ---
let message;
(async () => {
  try {
    const worker = createTestWorker('./js/worker.js');
    message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timeout')), 2000);

      worker.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data);
      };
    });

    expect(message).to.equal('ready');
    textContent = '✅ Worker initialization test passed';
    console.log('✅ Worker initialization test passed');

  } catch (error) {
    textContent = `❌ Worker initialization test failed: ${error.message}`;
    console.error(`❌ Worker initialization test failed: ${message}`);
  }
  
  liItem.textContent = textContent;
  orederedList.appendChild(liItem);
})();

