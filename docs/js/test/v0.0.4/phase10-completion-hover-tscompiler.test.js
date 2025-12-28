// test/v0.0.4/phase10-completion-hover-tscompiler.test.js
// v0.0.4.2 initialize 内部 ensureReady 方式

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 phase10-completion-hover-tscompiler.test loaded (v0.0.4.2)');

(async () => {
  const testName =
    'phase10: completion / hover returns TS Compiler API based result (initialize ensures ready)';
  let worker;

  try {
    /* ---------- worker boot ---------- */

    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    /* ---------- initialize ---------- */

    await sendRequest(worker, 'lsp/initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
    });

    sendNotification(worker, 'lsp/initialized');

    /* ---------- open document ---------- */

    const uri = 'file:///phase10.ts';
    const content = `
const num = 123;
num.
`;

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content,
    });

    /* ---------- completion ---------- */

    const completion = await sendRequest(worker, 'textDocument/completion', {
      textDocument: { uri },
      position: { line: 2, character: 4 },
    });

    if (!completion?.items?.length) {
      throw new Error('completion.items empty');
    }

    /* ---------- hover ---------- */

    const hover = await sendRequest(worker, 'textDocument/hover', {
      textDocument: { uri },
      position: { line: 1, character: 6 },
    });

    if (!hover?.contents?.value) {
      throw new Error('hover.contents invalid');
    }

    if (!hover.contents.value.includes('number')) {
      throw new Error('hover does not include type info');
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
