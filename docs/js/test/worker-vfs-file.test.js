// test/worker-vfs-file.test.js
// v0.0.1.2

import { expect } from 'chai';
import { createTestWorker } from './test-utils.js';

console.log('🧩 worker-vfs-file.test.js loaded');

const orderedList = document.getElementById('testOrdered');
const liItem = document.createElement('li');

(async () => {
  let textContent;
  try {
    const worker = createTestWorker('./js/worker.js');

    // 直接送る (ready待ちは不要だが、準備済みを期待するなら待っても良い)
    worker.postMessage('vfs-file-test');

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No vfs-file-test response')), 15000);
      worker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        if (type === 'response' && message?.status === 'ok') {
          clearTimeout(timer);
          resolve(message);
        } else if (type === 'error') {
          clearTimeout(timer);
          reject(new Error(message));
        }
      });
    });

    // 検証: 初回作成時には型エラーが期待される(string->number の不一致)
    expect(result.diagnosticsCountBefore).to.be.greaterThan(0);
    // 更新後はエラーが0になっているはず(数値に置換しているため)
    expect(result.diagnosticsCountAfter).to.equal(0);

    textContent = `✅ Worker vfs-file-test passed (before:${result.diagnosticsCountBefore} after:${result.diagnosticsCountAfter})`;
    console.log(textContent);
  } catch (error) {
    textContent = `❌ Worker vfs-file-test failed: ${error.message}`;
    console.error(textContent);
  }

  liItem.textContent = textContent;
  orderedList.appendChild(liItem);
})();

