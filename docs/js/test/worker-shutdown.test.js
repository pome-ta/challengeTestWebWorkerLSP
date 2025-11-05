// test/worker-shutdown.test.js
// v0.0.0.3

import {expect} from 'chai';
import {createTestWorker} from './test-utils.js';


console.log('🧩 worker-shutdown.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

let textContent;

// --- テスト開始 ---
(async () => {
  try {
    const worker = createTestWorker('./js/worker.js');

    // まず ready を待つ
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('No ready signal')),
        2000
      );
      worker.addEventListener('message', (event) => {
        const {type} = event.data;
        if (type === 'ready') {
          clearTimeout(timer);
          resolve();
        }
      });
    });


    // shutdown を送る
    worker.postMessage('shutdown');

    // shutdown-complete を待つ
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('No shutdown-complete response')),
        2000
      );
      worker.addEventListener('message', (event) => {
        const {type, message} = event.data;
        if (type === 'response' && message === 'shutdown-complete') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    expect(message).to.equal('shutdown-complete');
    textContent = '✅ Worker shutdown test passed';
    console.log('✅ Worker shutdown test passed');
  } catch (error) {
    textContent = `❌ Worker shutdown test failed: ${error.message}`;
    console.error(`❌ Worker shutdown test failed: ${error}`);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();
