// test/v0.0.3/lsp-initialize-success.test.js
// v0.0.3.4

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 lsp-initialize-success.test loaded');

(async () => {
  const testName = 'LSP initialize succeeds after VFS ready';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');
    const result = await sendRequest(worker, 'lsp/initialize', {});

    if (result?.capabilities == null) {
      throw new Error('initialize returned no capabilities');
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
