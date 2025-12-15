// test/v0.0.3/lsp-initialize-before-vfs.test.js
// v0.0.3.x

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 lsp-initialize-before-vfs.test loaded');

(async () => {
  const testName = 'LSP initialize fails before ensureReady';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    let failed = false;
    try {
      await sendRequest(worker, 'lsp/initialize', {});
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
