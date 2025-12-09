// test/v0.0.3/vfs-ensureReady.basic.test.js
// v0.0.3.0

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-ensureReady.basic.test loaded');

(async () => {
  const testName = 'VFS: ensureReady should complete without error';
  let worker;
  try {
    worker = createTestWorker('./js/worker.js');

    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');

    // no exception -> success
    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
