// test/v0.0.4/phase10-completion-hover-tsls.test.js
// v0.0.4.1
//
// 目的:
// - completion / hover が TypeScript Language Service の実結果を返す
// - Phase 9 のダミー実装では成立しないこと
// - Phase 8/9 のテストを一切破壊しないこと

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 phase10-completion-hover-tsls.test loaded');

(async () => {
  const testName =
    'phase10: completion / hover returns TS Language Service based result';
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
type User = {
  name: string;
  age: number;
};

const user: User = {
  name: 'Alice',
  age: 30,
};

user.
`.trim();

    await sendRequest(worker, 'vfs/openFile', {
      uri,
      content,
    });

    /* ---------- completion ---------- */

    const completion = await sendRequest(worker, 'textDocument/completion', {
      textDocument: { uri },
      position: { line: 9, character: 5 }, // "user.|"
    });

    if (!completion || !Array.isArray(completion.items)) {
      throw new Error('completion.items missing');
    }

    const labels = completion.items.map((it) => it.label);

    // TS LS が生きていれば、User の property が出る
    if (!labels.includes('name') || !labels.includes('age')) {
      throw new Error(
        `TS-based completion missing (got: ${labels.join(', ')})`,
      );
    }

    /* ---------- hover ---------- */

    const hover = await sendRequest(worker, 'textDocument/hover', {
      textDocument: { uri },
      position: { line: 5, character: 7 }, // User
    });

    if (!hover || !hover.contents) {
      throw new Error('hover.contents missing');
    }

    const value =
      typeof hover.contents.value === 'string'
        ? hover.contents.value
        : '';

    if (!value.includes('type User')) {
      throw new Error(`hover does not describe type User: ${value}`);
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();