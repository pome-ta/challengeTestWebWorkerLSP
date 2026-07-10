import { getDiagnosticSeverity } from '../mappers/diagnosticSeverity.js';
import { postLog } from '../../logger.js';

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
      const diagnosticsData = this.#tsEnv.getDiagnostics(uri);

      // 無視したいエラーコード（必要に応じて追加）
      const ignoredCodes = new Set([2354]);

      const diagnostics = diagnosticsData
        .filter((diag) => !ignoredCodes.has(diag.code))
        .map((diag) => ({
          range: diag.range,
          severity: getDiagnosticSeverity(diag.category),
          source: 'typescript',
          message: diag.message,
          code: diag.code,
        }));

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
