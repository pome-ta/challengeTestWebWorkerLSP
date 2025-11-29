// core/diag-utils.js
// v0.0.3.0-alpha
// - Diagnostic utilities centered: flattening and TS->LSP mapping
// - Exports:
//    - flattenDiagnosticMessage(diag, ts) -> string
//    - mapTsDiagnosticToLsp(diag, path, program, ts) -> LSP Diagnostic
//
// Notes:
// - Relies on ts.flattenDiagnosticMessageText for message flattening.
// - Does NOT inject relatedInformation text into the main message (avoid duplication).
// - Maps TS relatedInformation into LSP relatedInformation when location available.

import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';

/**
 * Safe wrapper around ts.flattenDiagnosticMessageText
 * Falls back to string conversion if TS util throws for any reason.
 *
 * @param {string | ts.DiagnosticMessageChain} msg
 * @returns {string}
 */
function _safeFlatten(msg) {
  try {
    return ts.flattenDiagnosticMessageText(msg, '\n');
  } catch (e) {
    try {
      return String(msg ?? '');
    } catch {
      return '';
    }
  }
}

/**
 * Return flattened root message for a TypeScript Diagnostic.
 * NOTE: This intentionally does NOT append relatedInformation text to the message.
 *
 * @param {ts.Diagnostic} diag
 * @returns {string}
 */
export function flattenDiagnosticMessage(diag) {
  if (!diag) return '';
  return _safeFlatten(diag.messageText);
}

/**
 * Normalize a TS-side file identifier to a file URI.
 * - If input already looks like a file:// URI, return as-is.
 * - If input is an absolute path (startsWith '/'), prefix with "file://".
 * - Otherwise prefix with "file://" (best-effort).
 *
 * Keep this function intentionally simple; VFS should provide canonicalization when available.
 *
 * @param {string} fileName
 * @returns {string|null}
 */
function _toFileUri(fileName) {
  if (!fileName) return null;
  const s = String(fileName);
  if (s.startsWith('file://')) return s;
  // Ensure leading slash preserved if present
  return `file://${s}`;
}

/**
 * Map a TypeScript Diagnostic -> LSP Diagnostic object.
 * - message: flattened root message (no relatedInformation text injected)
 * - relatedInformation: mapped only when a location (file + position) can be determined
 *
 * @param {ts.Diagnostic} diag
 * @param {string} path absolute vfs path (e.g. "/entry.ts")
 * @param {ts.Program | undefined} program
 * @returns {object} LSP Diagnostic
 */
export function mapTsDiagnosticToLsp(diag, path, program) {
  // defensive defaults
  const start = typeof diag.start === 'number' ? diag.start : 0;
  const length = typeof diag.length === 'number' ? diag.length : 0;

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

  // Flatten root message only (no relatedInformation text appended)
  const message = _safeFlatten(diag.messageText);

  // Severity mapping
  let severity = 1; // default to Error
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

  // Map relatedInformation -> LSP relatedInformation (only when location can be formed)
  try {
    if (Array.isArray(diag.relatedInformation) && diag.relatedInformation.length > 0) {
      const riList = [];
      for (const ri of diag.relatedInformation) {
        try {
          // ri may have ri.file (ts.SourceFile) or ri.file as string in some contexts
          let riUri = null;
          let riRange = {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          };

          if (ri?.file && typeof ri.file === 'object' && typeof ri.file.fileName === 'string') {
            // TS SourceFile case
            riUri = _toFileUri(ri.file.fileName);
            if (typeof ri.start === 'number') {
              const pos = ts.getLineAndCharacterOfPosition(ri.file, ri.start);
              riRange = {
                start: { line: pos.line, character: pos.character },
                end: { line: pos.line, character: pos.character },
              };
            }
          } else if (ri?.file && typeof ri.file === 'string') {
            // fallback: file is string path
            riUri = _toFileUri(ri.file);
            if (typeof ri.start === 'number') {
              // We don't have a SourceFile object to compute line/char; leave default 0,0
              // (Some environments may include line/char in the string; we avoid fragile parsing)
            }
          }

          const riMsg = _safeFlatten(ri.messageText);

          if (riUri) {
            riList.push({
              location: { uri: riUri, range: riRange },
              message: riMsg,
            });
          } else {
            // If there is no location, do not create an LSP relatedInformation entry
            // (LSP relatedInformation expects a `location`); keep the main message unchanged.
          }
        } catch (e) {
          postLog(`diag-utils.mapTsDiagnosticToLsp: failed mapping a relatedInformation entry: ${String(e?.message ?? e)}`);
          // continue mapping others
        }
      }

      if (riList.length > 0) {
        lsp.relatedInformation = riList;
      }
    }
  } catch (e) {
    postLog(`diag-utils.mapTsDiagnosticToLsp: unexpected error mapping relatedInformation: ${String(e?.message ?? e)}`);
  }

  return lsp;
}

export const DiagUtils = {
  flattenDiagnosticMessage,
  mapTsDiagnosticToLsp,
};
