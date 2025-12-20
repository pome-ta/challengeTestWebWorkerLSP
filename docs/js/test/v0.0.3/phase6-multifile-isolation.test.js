// test/v0.0.3/phase6-multifile-isolation.test.js
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
    'phase6: multi-file close does not affect other documents';

  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', {
      rootUri: null,
      capabilities: {},
    });

    const uriA = 'file:///a.ts';
    const uriB = 'file:///b.ts';

    await sendRequest(worker, 'vfs/openFile', {
      uri: uriA,
      content: 'A1',
    });

    await sendRequest(worker, 'vfs/openFile', {
      uri: uriB,
      content: 'B1',
    });

    await sendRequest(worker, 'vfs/closeFile', { uri: uriA });

    await sendRequest(worker, 'vfs/openFile', {
      uri: uriB,
      content: 'B2',
    });

    const didChange = await sendRequest(
      worker,
      'lsp/_debug/getLastDidChange'
    );

    expect(didChange.uri).to.equal(uriB);
    expect(didChange.version).to.equal(2);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();