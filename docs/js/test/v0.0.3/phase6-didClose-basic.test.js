// test/v0.0.3/phase6-didClose-basic.test.js
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
    'phase6: didClose emitted once after initialize';

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
      content: 'const a = 1;',
    });

    await sendRequest(worker, 'vfs/closeFile', { uri });

    const didClose = await sendRequest(
      worker,
      'lsp/_debug/getLastDidClose'
    );

    expect(didClose).to.be.an('object');
    expect(didClose.uri).to.equal(uri);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();