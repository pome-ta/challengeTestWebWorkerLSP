// test/v0.0.2/diag-chain-related.test.js
// v0.0.2.10
import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 diag-chain-related.test loaded');

(async () => {
  const testName =
    'Diagnostics flatten (relatedInformation): message-chain + LSP-related flatten consistency';

  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // bootstrap
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // --- multi-file setup ---
    const helperUri = 'file:///helper.ts';
    const helperContent = `
      export type NumBox = { value: number };
    `;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: helperUri,
        languageId: 'typescript',
        version: 1,
        text: helperContent,
      },
    });

    const entryUri = 'file:///entry.ts';
    const entryContent = `
      import { NumBox } from "./helper";
      const wrong: NumBox = { value: "oops" };
    `;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: entryUri,
        languageId: 'typescript',
        version: 1,
        text: entryContent,
      },
    });

    // wait publishDiagnostics
    const published = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === entryUri
    );

    expect(published).to.exist;
    expect(published.diagnostics).to.be.an('array').with.lengthOf.at.least(1);

    const pubDiag = published.diagnostics[0];
    const flattened = pubDiag.message;
    expect(flattened).to.include('not assignable');

    // --- raw diagnostics ---
    const rawResult = await sendRequest(worker, 'lsp/_getRawDiagnostics', {
      uri: entryUri,
    });

    expect(rawResult).to.exist;
    expect(rawResult.diagnostics).to.be.an('array');

    const rawDiag = rawResult.diagnostics[0];
    const messageText = rawDiag.messageText;

    // messageText must be chain or string
    const isChain =
      messageText &&
      typeof messageText === 'object' &&
      'messageText' in messageText;

    expect(isChain || typeof messageText === 'string').to.be.true;

    // --- LSP の関連情報は publish 時にのみ付与される ---
    // raw TS diagnostics には relatedInformation は無い
    // よって、flattened に chain のテキストが含まれていることだけを確認する

    const chainRootMsg =
      typeof messageText === 'string'
        ? messageText
        : messageText.messageText;

    expect(flattened).to.include(chainRootMsg);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
