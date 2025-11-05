// test/worker-init.test.js
// v0.0.0.1

import {expect} from 'chai';
import {createTestWorker} from './test-utils.js';

console.log('🧩 worker-init.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

let textContent;

// --- テスト開始 ---

(async () => {
  try {
    const worker = createTestWorker('./js/worker.js');
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timeout')), 2000);

      worker.addEventListener('message', (event) => {
        const {type} = event.data;
        if (type === 'ready') {
          clearTimeout(timer);
          resolve(type);
        }
      });
    });

    expect(message).to.equal('ready');
    textContent = '✅ Worker initialization test passed';
    console.log('✅ Worker initialization test passed');
  } catch (error) {
    textContent = `❌ Worker initialization test failed: ${error.message}`;
    console.error(`❌ Worker initialization test failed: ${error}`);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
