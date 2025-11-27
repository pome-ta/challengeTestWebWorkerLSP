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

console.log('diag-chain-related.test loaded');

(async () => {
  const testName =
    'Diagnostics flatten (relatedInformation): message chain + related info flatten consistency';

  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1) bootstrap / initialize
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // 2) multi-file setup to produce a DiagnosticMessageChain with relatedInformation
    //
    // helper.ts: exports a type requiring number
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

    // entry.ts: imports NumBox but provides incompatible type → produces chain+relatedInformation
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

    // 3) Wait for publishDiagnostics for entry.ts
    const published = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === entryUri
    );

    expect(published).to.exist;
    expect(published.diagnostics).to.be.an('array').with.lengthOf.at.least(1);

    const pubDiag = published.diagnostics[0];
    const flattened = pubDiag.message; // string

    expect(flattened).to.be.a('string');
    expect(flattened).to.include('not assignable'); // base assertion
    expect(flattened).to.include('value');           // property involved

    // 4) Now request raw diagnostics (test-only)
    const rawResult = await sendRequest(worker, 'lsp/_getRawDiagnostics', {
      uri: entryUri,
    });
    expect(rawResult).to.exist;
    expect(rawResult.diagnostics).to.be.an('array');

    const rawDiag = rawResult.diagnostics[0];
    const messageText = rawDiag.messageText;

    // rawDiag.messageText must be a DiagnosticMessageChain to include relatedInformation
    const isChain =
      messageText &&
      typeof messageText === 'object' &&
      'messageText' in messageText;

    expect(isChain).to.be.true;

    // 5) assert relatedInformation exists in the raw chain
    //
    // In TS structure:
    //   DiagnosticMessageChain = {
    //     messageText: string,
    //     category: number,
    //     code: number,
    //     next?: DiagnosticMessageChain[],
    //     relatedInformation?: Diagnostic[]
    //   }
    //
    // For multi-file type mismatch, TS often generates at least one relatedInformation item.
    expect(messageText.relatedInformation).to.exist;
    expect(messageText.relatedInformation).to.be.an('array');
    expect(messageText.relatedInformation.length).to.be.greaterThan(0);

    const related0 = messageText.relatedInformation[0];
    expect(related0).to.have.property('messageText');

    // 6) Compare raw flatten vs published flatten
    //
    // Instead of re-implementing ts.flattenDiagnosticMessageText,
    // we simply ensure that the flattened published message contains
    // the relatedInformation inner messages.
    const relatedMessage = related0.messageText;
    if (typeof relatedMessage === 'string') {
      expect(flattened).to.include(relatedMessage);
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
