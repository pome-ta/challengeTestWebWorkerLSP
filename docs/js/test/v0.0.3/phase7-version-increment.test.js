// test/v0.0.3/phase7-version-increment.test.js
// v0.0.3.8

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 phase7-version-increment.test loaded');

(async () => {
  const testName = 'phase7: version increments on each didChange';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', {});

    const uri = 'file:///test.ts';

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: 'a',
    });

    await sendRequest(worker, 'textDocument/didChange', {
      textDocument: { uri },
      contentChanges: [{ text: 'b' }],
    });

    await sendRequest(worker, 'textDocument/didChange', {
      textDocument: { uri },
      contentChanges: [{ text: 'c' }],
    });

    const lastChange = await sendRequest(worker, 'lsp/_debug/getLastDidChange');

    expect(lastChange.version).to.equal(3);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
