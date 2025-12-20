// test/v0.0.3/phase6-didClose-no-change-after.test.js
// v0.0.3.7

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

(async () => {
  const testName =
    'phase6: update after didClose does not emit didChange';

  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', {
      rootUri: null,
      capabilities: {},
    });

    const uri = 'file:///a.ts';

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: 'v1',
    });

    await sendRequest(worker, 'vfs/closeFile', { uri });

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: 'v2',
    });

    const didChange = await sendRequest(
      worker,
      'lsp/_debug/getLastDidChange'
    );

    expect(didChange).to.equal(null);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();