// test/v0.0.3/vfs-openFile-didChange.test.js
// v0.0.3.5
//
// 目的:
// - vfs/openFile 後に同一 uri へ再度 vfs/openFile された場合
//   - version が +1 されること
//   - lsp/initialize 後に textDocument/didChange が 1 回発行されること
// - didChange は full text 同期であること
// - 観測はテスト専用 debug API に限定する
//
// 非目的:
// - 差分適用の正確性
// - diagnostics / hover の内容検証

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-didChange.test loaded');

(async () => {
  const testName =
    'phase4: vfs/openFile update triggers didChange with incremented version';

  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- VFS ready ---
    const ready = await sendRequest(worker, 'vfs/ensureReady');
    expect(ready.ok).to.equal(true);

    const uri = 'file:///test.ts';

    // --- 初回 openFile ---
    const contentV1 = 'const x: number = 1;';
    const openV1 = await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: contentV1,
    });
    expect(openV1.ok).to.equal(true);

    // --- 内容更新 openFile ---
    const contentV2 = 'const x: number = 2;';
    const openV2 = await sendRequest(worker, 'vfs/openFile', {
      uri,
      content: contentV2,
    });
    expect(openV2.ok).to.equal(true);

    // --- LSP initialize ---
    const initResult = await sendRequest(worker, 'lsp/initialize', {
      rootUri: null,
      capabilities: {},
    });
    expect(initResult).to.be.an('object');

    // --- didChange 観測（テスト専用） ---
    const didChange = await sendRequest(
      worker,
      'lsp/_debug/getLastDidChange'
    );

    expect(didChange).to.be.an('object');

    // --- 最小保証 ---
    expect(didChange.uri).to.equal(uri);
    expect(didChange.version).to.equal(2); // version increment
    expect(didChange.text).to.equal(contentV2); // full text sync

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();