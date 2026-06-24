// test/v0.0.3/vfs-openFile-envId-stable.test.js
// v0.0.3.4

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-envId-stable.test loaded');

(async () => {
  const testName = 'vfs/openFile does not change envId';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- 1. ensureReady ---
    await sendRequest(worker, 'vfs/ensureReady');

    const infoBefore = await sendRequest(worker, 'vfs/getEnvInfo');
    expect(infoBefore.ready).to.equal(true);
    expect(infoBefore.envId).to.be.a('number');

    const envIdBefore = infoBefore.envId;

    // --- 2. openFile ---
    const openResult = await sendRequest(worker, 'vfs/openFile', {
      uri: 'file:///envId-test.ts',
      content: 'const x = 1;',
    });

    expect(openResult.ok).to.equal(true);

    // --- 3. envId must be unchanged ---
    const infoAfter = await sendRequest(worker, 'vfs/getEnvInfo');

    expect(infoAfter.envId).to.equal(envIdBefore);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();