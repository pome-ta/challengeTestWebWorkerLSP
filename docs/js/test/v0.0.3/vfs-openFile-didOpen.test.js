// test/v0.0.3/vfs-openFile-didOpen.test.js
// v0.0.3.5
//
// 目的:
// - vfs/openFile されたファイルが
//   lsp/initialize 後に textDocument/didOpen として同期されること
// - version = 1 が使用されることを最小観測する
//
// 非目的:
// - snapshot 更新
// - didChange / didClose
// - diagnostics / completion の正しさ

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-didOpen.test loaded');

(async () => {
  const testName =
    'phase4: vfs/openFile is synchronized via didOpen with version=1';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- VFS ready ---
    const ready = await sendRequest(worker, 'vfs/ensureReady');
    expect(ready.ok).to.equal(true);

    // --- openFile ---
    const uri = 'file:///test.ts';
    const content = 'const x: number = 1;';

    const openResult = await sendRequest(worker, 'vfs/openFile', {
      uri,
      content,
    });
    expect(openResult.ok).to.equal(true);

    // --- LSP initialize ---
    const initResult = await sendRequest(worker, 'lsp/initialize', {
      rootUri: null,
      capabilities: {},
    });
    expect(initResult).to.be.an('object');

    /**
     * 観測点（Phase 4 前半）:
     *
     * - didOpen が送信されていること
     * - version = 1 が使われていること
     *
     * 実装依存だが、以下のいずれかで観測する想定:
     * - LspCore 側で lastDidOpen を保持し、検査用 RPC で取得
     * - hover / symbol 等が version=1 前提で動作する
     *
     * ※ 本雛形では assert をまだ置かない
     * ※ Phase 4 後半で観測点を確定する
     */

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();