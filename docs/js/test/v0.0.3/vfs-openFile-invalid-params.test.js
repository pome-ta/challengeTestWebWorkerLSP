// test/v0.0.3/vfs-openFile-invalid-params.test.js
// v0.0.3.4

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-invalid-params.test loaded');

(async () => {
  const testName = 'vfs/openFile invalid params returns -32602';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // ensureReady は呼ばない（params validation が先）
    try {
      await sendRequest(worker, 'vfs/openFile', {
        uri: '',
        content: 123, // string ではない
      });

      throw new Error('openFile should fail');
    } catch (err) {
      expect(err.code).to.equal(-32602);
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
