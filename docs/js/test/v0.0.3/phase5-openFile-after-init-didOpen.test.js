// test/v0.0.3/phase5-openFile-after-init-didOpen.test.js
// v0.0.3.6

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 phase5-openFile-after-init-didOpen.test loaded');

(async () => {
  const testName = 'phase5: openFile after initialize emits didOpen';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', {
      rootUri: null,
      capabilities: {},
    });

    const uri = 'file:///test.ts';
    const content = 'const x = 1;';

    await sendRequest(worker, 'vfs/openFile', { uri, content });

    const didOpen = await sendRequest(worker, 'lsp/_debug/getLastDidOpen');

    expect(didOpen).to.deep.equal({
      uri,
      version: 1,
      text: content,
    });

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
