// test/v0.0.3/vfs-ensureReady-idempotent.test.js
// v0.0.3.5

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-ensureReady-idempotent.test loaded');

(async () => {
  const testName = 'VFS ensureReady is idempotent';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await Promise.all([
      sendRequest(worker, 'vfs/ensureReady'),
      sendRequest(worker, 'vfs/ensureReady'),
      sendRequest(worker, 'vfs/ensureReady'),
    ]);

    const info = await sendRequest(worker, 'vfs/getEnvInfo');
    expect(info.envId).to.equal(1);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
