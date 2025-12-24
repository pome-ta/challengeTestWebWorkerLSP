// test/v0.0.3/phase10-completion-hover-tscompiler.test.js
// v0.0.4.1

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 phase10-completion-hover-tscompiler.test loaded');

(async () => {
  const testName =
    'phase10: completion / hover returns TS Compiler API based result';
  let worker;

  try {
    /* ---------- worker boot ---------- */

    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    /* ---------- VFS ready ---------- */

    const ready = await sendRequest(worker, 'vfs/ensureReady');
    if (!ready?.ok) {
      throw new Error('vfs/ensureReady failed');
    }

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

    if (
      !completion ||
      !Array.isArray(completion.items) ||
      completion.items.length === 0
    ) {
      throw new Error('completion.items empty');
    }

    if (typeof completion.items[0].label !== 'string') {
      throw new Error('completion label invalid');
    }

    /* ---------- hover ---------- */

    const hover = await sendRequest(worker, 'textDocument/hover', {
      textDocument: { uri },
      position: { line: 1, character: 6 },
    });

    if (
      !hover ||
      !hover.contents ||
      typeof hover.contents.value !== 'string'
    ) {
      throw new Error('hover.contents invalid');
    }

    // Compiler API ベースであることの最低保証
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