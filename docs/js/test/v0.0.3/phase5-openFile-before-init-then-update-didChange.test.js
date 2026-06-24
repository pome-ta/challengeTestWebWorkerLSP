// test/v0.0.3/phase5-openFile-before-init-then-update-didChange.test.js
// v0.0.3.6

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 phase5-openFile-before-init-then-update-didChange.test loaded');

(async () => {
  const testName =
    'phase5: openFile before initialize then update emits didChange';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');

    const uri = 'file:///test.ts';

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: 'const x = 1;',
    });

    await sendRequest(worker, 'lsp/initialize', {
      rootUri: null,
      capabilities: {},
    });

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: 'const x = 2;',
    });

    const didChange = await sendRequest(
      worker,
      'lsp/_debug/getLastDidChange'
    );

    expect(didChange).to.deep.equal({
      uri,
      version: 2,
      text: 'const x = 2;',
    });

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();