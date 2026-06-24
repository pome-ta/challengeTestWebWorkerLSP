// test/v0.0.3/vfs-before-ensureReady.test.js
// v0.0.3.4

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-before-ensureReady.test loaded');

(async () => {
  const testName = 'VFS API throws before ensureReady';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    let failed = false;
    try {
      await sendRequest(worker, 'vfs/openFile', {
        path: '/src/a.ts',
        content: 'export const a = 1;',
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
