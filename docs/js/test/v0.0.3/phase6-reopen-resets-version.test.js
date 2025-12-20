// test/v0.0.3/phase6-reopen-resets-version.test.js
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
    'phase6: reopen after close emits didOpen with version 1';

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

    const didOpen = await sendRequest(
      worker,
      'lsp/_debug/getLastDidOpen'
    );

    expect(didOpen.uri).to.equal(uri);
    expect(didOpen.version).to.equal(1);
    expect(didOpen.text).to.equal('v2');

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();