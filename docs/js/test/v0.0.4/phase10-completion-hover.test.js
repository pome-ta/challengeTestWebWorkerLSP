// test/v0.0.4/phase10-completion-hover.test.js
// v0.0.4.1 – LSP互換API版

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  addResult,
} from './test-utils.js';

const WORKER_PATH = '../src/worker.js';

const TEST_URI = 'file:///phase10.ts';
const TEST_CONTENT = `
export function add(a: number, b: number) {
  return a + b;
}

add(1, 2);
`;

(async () => {
  const name = 'phase10: completion & hover (LSP API unified)';

  try {
    //
    // 1. Worker 起動
    //
    const worker = createTestWorker(WORKER_PATH);

    //
    // 2. worker/ready を待つ
    //
    await waitForWorkerReady(worker);

    //
    // 3. initialize（内部で ensureReady 実行される前提）
    //
    await sendRequest(worker, 'initialize', {
      rootUri: 'file:///',
      capabilities: {},
    });

    //
    // 4. didOpen → VFS にファイルを登録
    //
    await sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: TEST_URI,
        languageId: 'typescript',
        version: 1,
        text: TEST_CONTENT,
      },
    });

    //
    // 5. completion テスト
    //
    const completionResult = await sendRequest(worker, 'textDocument/completion', {
      textDocument: { uri: TEST_URI },
      position: { line: 5, character: 4 }, // "add|" 付近
    });

    if (!completionResult || !Array.isArray(completionResult.items)) {
      throw new Error('completion result invalid or missing items');
    }

    const hasAdd = completionResult.items.some((i) => i.label === 'add');

    if (!hasAdd) {
      throw new Error('completion does not include exported symbol "add"');
    }

    //
    // 6. hover テスト
    //
    const hoverResult = await sendRequest(worker, 'textDocument/hover', {
      textDocument: { uri: TEST_URI },
      position: { line: 1, character: 16 }, // function add(a...
    });

    if (!hoverResult || !hoverResult.contents) {
      throw new Error('hover result is missing');
    }

    //
    // 7. テスト成功
    //
    addResult(name, true, 'completion & hover succeeded');

    worker.terminate();
  } catch (err) {
    console.error(err);
    addResult('phase10: completion & hover (LSP API unified)', false, String(err?.message ?? err));
  }
})();