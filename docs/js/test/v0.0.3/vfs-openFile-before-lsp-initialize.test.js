// test/v0.0.4/vfs-openFile-before-lsp-initialize.test.js
// v0.0.3.4

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-before-lsp-initialize.test loaded');

(async () => {
  const testName = 'vfs/openFile before lsp/initialize is visible to LSP';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- ensureReady ---
    const readyResult = await sendRequest(worker, 'vfs/ensureReady');
    expect(readyResult.ok).to.equal(true);

    // --- openFile ---
    await sendRequest(worker, 'vfs/openFile', {
      uri: 'file:///test.ts',
      content: 'const x: number = 1;',
    });

    // --- lsp/initialize ---
    const initResult = await sendRequest(worker, 'lsp/initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
    });

    expect(initResult).to.have.property('capabilities');

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();