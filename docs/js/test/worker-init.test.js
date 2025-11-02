// test/worker-init.test.js
// v0.0.0.1

import { expect } from 'chai';

console.log('🧩 worker-init.test.js loaded');

const results = document.getElementById('results');

// --- テスト開始 ---
(async () => {
  try {
    const worker = new Worker('./js/worker.js', { type: 'module' });

    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timeout')), 2000);

      worker.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data);
      };
    });

    expect(message).to.equal('ready');
    results.textContent = '✅ Worker initialization test passed';
    console.log('✅ Worker initialization test passed');

  } catch (err) {
    results.textContent = '❌ Worker initialization test failed: ' + err.message;
    console.error('❌ Worker initialization test failed:', err);
  }
})();

