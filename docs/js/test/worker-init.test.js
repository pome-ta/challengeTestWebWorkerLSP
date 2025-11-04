// test/worker-init.test.js
// v0.0.0.1

import { expect } from 'chai';

console.log('🧩 worker-init.test.js loaded');

const results = document.getElementById('results');
const orederedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

let textContent;

// --- テスト開始 ---
(async () => {
  try {
    const worker = new Worker('./js/worker.js', { type: 'module' });

    const message = await new Promise((resolve, reject) => {
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

