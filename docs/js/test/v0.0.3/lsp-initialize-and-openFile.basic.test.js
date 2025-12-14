// test/v0.0.3/lsp-initialize-and-openFile.basic.test.js
// v0.0.3.1

import { expect } from 'chai';
import {
  addResult,
  createTestWorker,
  sendNotification,
  sendRequest,
  waitForNotification,
  waitForWorkerReady,
} from './test-utils.js';

console.log('🧩 lsp-initialize-and-openFile.basic.test loaded');

(async () => {
  const testName = 'LSP: initialize and didOpen basic flow';
  let worker;
  try {
    worker = createTestWorker('./js/worker.js');

    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    const fileUri = 'file:///basic-open.ts';
    const content = `export const v = 1;`;

    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: fileUri,
        languageId: 'typescript',
        version: 1,
        text: content,
      },
    });

    const diag = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (p) => p.uri === fileUri
    );
    expect(diag.uri).to.equal(fileUri);
    expect(diag.diagnostics).to.be.an('array');

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
