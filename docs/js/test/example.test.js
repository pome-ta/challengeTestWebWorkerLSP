import { expect } from 'https://esm.sh/chai@5.1.1';

console.log('🧩 sample.test.js loaded');

try {
  expect(true).to.equal(true);
  document.getElementById('results').textContent = '✅ Test passed';
  console.log('✅ Test passed');
} catch (e) {
  document.getElementById('results').textContent =
    '❌ Test failed: ' + e.message;
  console.error('❌ Test failed:', e);
}
