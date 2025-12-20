// test/v0.0.3/phase7-before-initialize.test.js
// v0.0.3.8

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 phase7-before-initialize.test loaded');

(async () => {
  const testName = 'phase7: didChange before initialize does nothing';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');

    const uri = 'file:///test.ts';

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: 'a',
    });

    await sendRequest(worker, 'textDocument/didChange', {
      textDocument: { uri },
      contentChanges: [{ text: 'b' }],
    });

    const diagnostics = await sendRequest(
      worker,
      'lsp/_debug/getLastDiagnostics'
    );

    expect(diagnostics).to.equal(null);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();