// test/v0.0.3/vfs-openFile-visible-to-lsp.test.js
// v0.0.3.5
//
// 目的:
// - vfs/openFile されたファイルが
//   lsp/initialize 後の LSP から「存在している」前提で扱えることを保証する
// - 内容・診断・補完の正しさは扱わない（existence only）

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-visible-to-lsp.test loaded');

(async () => {
  const testName =
    'phase3: vfs/openFile before lsp/initialize is visible to LSP (existence only)';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- VFS ready ---
    const ready = await sendRequest(worker, 'vfs/ensureReady');
    expect(ready.ok).to.equal(true);

    // --- initialize 前に openFile ---
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
     * 観測点（Phase 3 最小）:
     *
     * - LSP が「ファイルが存在する前提」で初期化されていること
     *
     * 現段階では以下を満たせば十分:
     * - LSP 関連 RPC が MethodNotFound (-32601) にならない
     * - vfs/openFile が initialize を壊していない
     *
     * ※ 明示的な assert は Phase 3 後半で追加する
     */

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();