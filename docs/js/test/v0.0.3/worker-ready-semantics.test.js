// test/v0.0.3/worker-ready-semantics.test.js
// v0.0.3.x

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-ready-semantics.test loaded');

(async () => {
  const testName = 'worker/ready does not imply VFS ready';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    let failed = false;
    try {
      await sendRequest(worker, 'vfs/openFile', {
        path: '/x.ts',
        content: 'x',
      });
    } catch {
      failed = true;
    }

    expect(failed).to.equal(true);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
