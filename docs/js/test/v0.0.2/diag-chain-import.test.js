// test/v0.0.2/diag-chain-import.test.js
// v0.0.2.11
// multi-file import chain の flatten consistency test

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 diag-chain-import.test loaded');

(async () => {
  const testName =
    'Diagnostics flatten (import-chain): multi-file chain + LSP flatten consistency';

  let worker;

  try {
    // --- Worker 起動 ---
    worker = createTestWorker('./js/worker.js');

    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // -------------------------------------------------------------
    // multi-file import chain:
    //
    //   entry.ts  →  helper.ts  →  types.ts
    //
    // そして types.ts の型定義に対して misuse して diagnostics を誘発。
    // -------------------------------------------------------------

    // ---------- types.ts ----------
    const typesUri = 'file:///types.ts';
    const typesContent = `
      export interface ValueBox {
        value: number;
      }
    `;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: typesUri,
        languageId: 'typescript',
        version: 1,
        text: typesContent,
      },
    });

    // ---------- helper.ts ----------
    const helperUri = 'file:///helper.ts';
    const helperContent = `
      import { ValueBox } from "./types";
      export const makeBox = (v: ValueBox) => v;
    `;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: helperUri,
        languageId: 'typescript',
        version: 1,
        text: helperContent,
      },
    });

    // ---------- entry.ts ----------
    const entryUri = 'file:///entry.ts';
    const entryContent = `
      import { makeBox } from "./helper";
      
      // ValueBox.value は number の必要があるが string を入れる
      const x = makeBox({ value: "not-number" });
    `;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: entryUri,
        languageId: 'typescript',
        version: 1,
        text: entryContent,
      },
    });

    // --- publishDiagnostics を待つ ---
    const published = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === entryUri
    );

    // publishDiagnostics が最低1件はあるはず
    if (!published?.diagnostics || !published.diagnostics.length) {
      throw new Error('No diagnostics published.');
    }

    const publishedDiag = published.diagnostics[0];
    const flattened = publishedDiag.message;

    // flatten は "not assignable" などの TS メッセージを含むことが多い
    if (typeof flattened !== 'string') {
      throw new Error('Flattened message is not a string.');
    }

    // --- raw diagnostics を取得 ---
    const raw = await sendRequest(worker, 'lsp/_getRawDiagnostics', {
      uri: entryUri,
    });

    if (!raw?.diagnostics || raw.diagnostics.length === 0) {
      throw new Error('No raw diagnostics returned.');
    }

    const rawDiag = raw.diagnostics[0];
    const msgText = rawDiag.messageText;

    // messageText は string か TS の messageChain
    const isChain =
      msgText &&
      typeof msgText === 'object' &&
      'messageText' in msgText;

    if (!(isChain || typeof msgText === 'string')) {
      throw new Error('Unexpected raw diagnostic messageText type.');
    }

    // root message text を抽出
    const rootMsg =
      typeof msgText === 'string' ? msgText : msgText.messageText;

    // flatten が root message を含んでいるか検証
    if (!flattened.includes(rootMsg)) {
      throw new Error(
        `Flattened message does not include root message. root="${rootMsg}"`
      );
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();

