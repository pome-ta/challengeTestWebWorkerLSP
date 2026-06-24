// test/v0.0.3/phase7-diagnostics.test.js
// v0.0.3.8

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 phase7-diagnostics.test loaded');

(async () => {
  const testName = 'phase7: diagnostics emitted after didChange';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', {});

    const uri = 'file:///test.ts';

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: 'const x = 1;',
    });

    await sendRequest(worker, 'textDocument/didChange', {
      textDocument: { uri },
      contentChanges: [{ text: 'const x = 2;' }],
    });

    const diagnostics = await sendRequest(
      worker,
      'lsp/_debug/getLastDiagnostics'
    );

    expect(diagnostics.uri).to.equal(uri);
    expect(diagnostics.diagnostics).to.be.an('array');

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
