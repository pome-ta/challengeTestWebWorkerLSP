import ts from 'https://esm.sh/typescript';
import { getDiagnosticSeverity } from '../mappers/diagnosticSeverity.js';
import { postLog } from '../logger.js';

export class DiagnosticProvider {
  #tsEnv;
  #documentTimers = new Map();

  constructor(tsEnv) {
    this.#tsEnv = tsEnv;
  }

  triggerDiagnostics(uri) {
    if (this.#documentTimers.has(uri)) clearTimeout(this.#documentTimers.get(uri));
    const timer = setTimeout(() => {
      this.runDiagnostics(uri);
      this.#documentTimers.delete(uri);
    }, 300);
    this.#documentTimers.set(uri, timer);
  }

  runDiagnostics(uri) {
    try {
      const sourceFile = this.#tsEnv.getSourceFile(uri);
      if (!sourceFile) return;

      const syntactic = this.#tsEnv.getLanguageService().getSyntacticDiagnostics(uri);
      const semantic = this.#tsEnv.getLanguageService().getSemanticDiagnostics(uri);

      // 無視したいエラー（必要に応じて追加）
      const ignoredCodes = new Set([2354]);

      const diagnostics = [...syntactic, ...semantic]
        .filter((diag) => !ignoredCodes.has(diag.code))
        .map((diag) => {
          const startOffset = diag.start ?? 0;
          const endOffset = startOffset + (diag.length ?? 0);

          return {
            range: {
              start: ts.getLineAndCharacterOfPosition(sourceFile, startOffset),
              end: ts.getLineAndCharacterOfPosition(sourceFile, endOffset),
            },
            severity: getDiagnosticSeverity(diag.category),
            source: 'typescript',
            message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
            code: diag.code,
          };
        });

      self.postMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics },
      });
      postLog(`Published ${diagnostics.length} diagnostics for ${uri}`, 4);
    } catch (e) {
      postLog(`Diagnostics error: ${e.message}`, 1);
    }
  }
}
