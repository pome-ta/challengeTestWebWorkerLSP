// test/v0.0.3/vfs-resetForTest.test.js
// v0.0.3.4

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-resetForTest.test loaded');

(async () => {
  const testName = 'VFS resetForTest resets all state';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');
    const info1 = await sendRequest(worker, 'vfs/getEnvInfo');

    await sendRequest(worker, 'vfs/resetForTest');
    await sendRequest(worker, 'vfs/ensureReady');
    const info2 = await sendRequest(worker, 'vfs/getEnvInfo');

    expect(info1.envId).to.equal(1);
    expect(info2.envId).to.equal(1);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
