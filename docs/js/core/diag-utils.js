// core/diag-utils.js
// v0.0.3.0-alpha
// - Diagnostic utilities centered: flattening and TS->LSP mapping
// - Exports:
//    - flattenDiagnosticMessage(diag, ts, program?) -> string
//    - mapTsDiagnosticToLsp(diag, path, program, ts) -> LSP Diagnostic
//
// Notes:
// - Uses ts.flattenDiagnosticMessageText for core message flattening.
// - If TS Diagnostic contains relatedInformation, include their text in the flattened message
//   and produce LSP-style relatedInformation entries when possible.
// - Keep returned LSP diagnostic shape compatible with previous tests.

import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';

function _safeFlatten(msg) {
  try {
    return ts.flattenDiagnosticMessageText(msg, '\n');
  } catch (e) {
    return String(msg ?? '');
  }
}

/**
 * Produce a human-readable flattened string for a TS Diagnostic,
 * appending relatedInformation messages (if present) in a stable way.
 *
 * @param {ts.Diagnostic} diag
 * @returns {string}
 */
export function flattenDiagnosticMessage(diag) {
  if (!diag) return '';

  // Root message (may be string or DiagnosticMessageChain)
  const root = _safeFlatten(diag.messageText);

  const parts = [root];

  // Append next chains (if any) - TS flatten already handles 'next' in messageText,
  // but keep defensive concatenation for any nested messageText structures.
  // (ts.flattenDiagnosticMessageText usually suffices for main body)

  // relatedInformation may be present on the diagnostic
  if (Array.isArray(diag.relatedInformation) && diag.relatedInformation.length > 0) {
    parts.push('Related information:');
    for (const ri of diag.relatedInformation) {
      try {
        // ri.messageText may be string or chain
        const riMsg = _safeFlatten(ri.messageText);
        // include source location if available
        let loc = '';
        try {
          if (ri.file && typeof ri.start === 'number') {
            const pos = ts.getLineAndCharacterOfPosition(ri.file, ri.start);
            loc = ` (${ri.file.fileName}:${pos.line + 1}:${pos.character + 1})`;
          } else if (ri.file && !ri.file.fileName) {
            loc = ` (${ri.file}:${ri.start ?? '-'})`;
          }
        } catch (e) {
          // ignore location formatting errors
        }
        parts.push(`  - ${riMsg}${loc}`);
      } catch (e) {
        parts.push(`  - (failed to flatten relatedInformation: ${String(e?.message ?? e)})`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Map a TypeScript Diagnostic -> LSP Diagnostic (shape expected by publishDiagnostics).
 * - Produces `message` as flattened string (including relatedInformation text).
 * - Produces LSP `relatedInformation` array when TS relatedInformation is present and file/pos are available.
 *
 * @param {ts.Diagnostic} diag
 * @param {string} path absolute vfs path (e.g. "/entry.ts")
 * @param {ts.Program | undefined} program TypeScript program (may be undefined)
 * @returns {object} LSP Diagnostic
 */
export function mapTsDiagnosticToLsp(diag, path, program) {
  // defensive defaults
  const start = diag.start ?? 0;
  const length = diag.length ?? 0;

  let sourceFile = null;
  try {
    sourceFile = program?.getSourceFile(path) ?? null;
  } catch (e) {
    sourceFile = null;
  }

  const startPos =
    sourceFile && typeof start === 'number'
      ? ts.getLineAndCharacterOfPosition(sourceFile, start)
      : { line: 0, character: 0 };

  const endPos =
    sourceFile && typeof start === 'number' && typeof length === 'number'
      ? ts.getLineAndCharacterOfPosition(sourceFile, start + length)
      : { line: startPos.line, character: startPos.character };

  // Flatten message including relatedInformation lines
  let message = '';
  try {
    message = flattenDiagnosticMessage(diag);
  } catch (e) {
    message = _safeFlatten(diag.messageText);
  }

  // Severity mapping: TS categories: 0 = Warning, 1 = Error, 2 = Suggestion, 3 = Message
  // LSP severity: 1=Error,2=Warning,3=Information,4=Hint
  let severity = 1;
  if (typeof diag.category === 'number') {
    switch (diag.category) {
      case ts.DiagnosticCategory.Error:
        severity = 1;
        break;
      case ts.DiagnosticCategory.Warning:
        severity = 2;
        break;
      case ts.DiagnosticCategory.Suggestion:
        severity = 3;
        break;
      case ts.DiagnosticCategory.Message:
      default:
        severity = 3;
        break;
    }
  }

  const lsp = {
    range: { start: startPos, end: endPos },
    message,
    severity,
    source: 'ts',
    code: diag.code,
  };

  // Map relatedInformation entries into LSP relatedInformation when possible
  if (Array.isArray(diag.relatedInformation) && diag.relatedInformation.length > 0) {
    const riList = [];
    for (const ri of diag.relatedInformation) {
      try {
        // ri is ts.DiagnosticRelatedInformation
        // We try to obtain uri and range for the related item.
        let riUri = null;
        let riRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

        if (ri.file && ri.file.fileName) {
          // TS fileName is often absolute or vfs path; normalize to file://
          riUri = `file://${ri.file.fileName.startsWith('/') ? ri.file.fileName : ri.file.fileName}`;
          if (typeof ri.start === 'number') {
            const pos = ts.getLineAndCharacterOfPosition(ri.file, ri.start);
            riRange = {
              start: { line: pos.line, character: pos.character },
              end: { line: pos.line, character: pos.character },
            };
          }
        } else if (ri.file && typeof ri.file === 'string') {
          // fallback when ri.file is a string path
          riUri = `file://${ri.file.startsWith('/') ? ri.file : ri.file}`;
        }

        const riMsg = _safeFlatten(ri.messageText);

        const riObj = {
          location: riUri ? { uri: riUri, range: riRange } : undefined,
          message: riMsg,
        };

        // conform to LSP relatedInformation: { location: { uri, range }, message }
        if (riObj.location) {
          riList.push({ location: riObj.location, message: riObj.message });
        } else {
          // if no location, still capture as message-only related info (attach to message instead)
          // but do not push an undefined-location object.
        }
      } catch (e) {
        // ignore mapping errors; do not break diagnostics
        postLog(`diag-utils.mapTsDiagnosticToLsp: failed to map relatedInformation: ${String(e?.message ?? e)}`);
      }
    }

    if (riList.length > 0) {
      lsp.relatedInformation = riList;
    }
  }

  return lsp;
}

export const DiagUtils = {
  flattenDiagnosticMessage,
  mapTsDiagnosticToLsp,
};
