// test/v0.0.3/phase9-completion-hover.test.js
// v0.0.3.10 (fixed)

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 phase9-completion-hover.test loaded');

(async () => {
  const testName = 'phase9: completion / hover returns concrete content';
  let worker;

  try {
    /* ---------- worker boot ---------- */

    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    /* ---------- VFS ready (必須) ---------- */

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

    const uri = 'file:///phase9.ts';
    const content = 'const answer = 42;\nanswer';

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content,
    });

    /* ---------- completion ---------- */

    const completion = await sendRequest(worker, 'textDocument/completion', {
      textDocument: { uri },
      position: { line: 1, character: 3 },
    });

    if (
      !completion ||
      !Array.isArray(completion.items) ||
      completion.items.length === 0
    ) {
      throw new Error('completion.items is empty');
    }

    if (typeof completion.items[0].label !== 'string') {
      throw new Error('completion item has no label');
    }

    /* ---------- hover ---------- */

    const hover = await sendRequest(worker, 'textDocument/hover', {
      textDocument: { uri },
      position: { line: 0, character: 6 },
    });

    if (!hover || !hover.contents || typeof hover.contents.value !== 'string') {
      throw new Error('hover.contents invalid');
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
