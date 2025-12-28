// test/v0.0.4/textDocumentManager.initialize-internal-ensureReady.test.js
// v0.0.4.3


import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 textDocumentManager.initialize-internal-ensureReady.test loaded');

(async () => {
  const testName =
    'TextDocumentManager: initialize internally calls ensureReady() (no explicit vfs/ensureReady required)';

  let worker;

  try {
    /* ---------- worker boot ---------- */

    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    /* ---------- IMPORTANT ----------
     *
     * ここでは vfs/ensureReady を呼ばない
     * initialize の内部で ensureReady() が呼ばれる設計前提
     * --------------------------------
     */

    /* ---------- initialize ---------- */

    await sendRequest(worker, 'lsp/initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
    });

    sendNotification(worker, 'lsp/initialized');

    /* ---------- open document via TextDocumentManager ---------- */

    const uri = 'file:///ensureReady-initialize.ts';
    const initial = `const a: number = 1;`;

    await sendRequest(worker, 'textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'typescript',
        version: 1,
        text: initial,
      },
    });

    /* ---------- change document ---------- */

    await sendRequest(worker, 'textDocument/didChange', {
      textDocument: {
        uri,
        version: 2,
      },
      contentChanges: [
        {
          text: `const a: number = 2;`,
        },
      ],
    });

    /* ---------- get document ---------- */

    const doc = await sendRequest(worker, 'textDocument/get', {
      uri,
    });

    if (doc.text !== 'const a: number = 2;') {
      throw new Error('document text mismatch after change');
    }

    if (doc.version !== 2) {
      throw new Error('document version mismatch after change');
    }

    /* ---------- list documents ---------- */

    const list = await sendRequest(worker, 'textDocument/list', {});

    if (!Array.isArray(list) || !list.includes(uri)) {
      throw new Error('document not listed in TextDocumentManager');
    }

    /* ---------- shutdown ---------- */

    await sendRequest(worker, 'lsp/shutdown', {});
    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err?.message || 'unknown error');
  } finally {
    worker?.terminate();
  }
})();