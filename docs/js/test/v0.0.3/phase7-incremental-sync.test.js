// test/v0.0.3/phase7-incremental-sync.test.js
// v0.0.3.8

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 phase7-incremental-sync.test loaded');

(async () => {
  const testName = 'phase7: incremental didChange updates document text';
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
      contentChanges: [
        {
          range: {
            start: { line: 0, character: 10 },
            end: { line: 0, character: 11 },
          },
          text: '2',
        },
      ],
    });

    const lastChange = await sendRequest(worker, 'lsp/_debug/getLastDidChange');

    expect(lastChange.text).to.equal('const x = 2;');

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
