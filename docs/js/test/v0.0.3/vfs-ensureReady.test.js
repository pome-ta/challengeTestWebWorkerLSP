// test/v0.0.3/vfs-ensureReady.test.js
// v0.0.3.x

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-ensureReady.test loaded');

(async () => {
  const testName = 'VFS ensureReady initializes env';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    const result = await sendRequest(worker, 'vfs/ensureReady');

    expect(result.ok).to.equal(true);

    const info = await sendRequest(worker, 'vfs/getEnvInfo');
    expect(info.envId).to.be.a('number');
    expect(info.defaultMapSize).to.be.greaterThan(0);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
