import ts from '../../esmCDN/typescript.js';

const DiagnosticSeverityMap = {
  [ts.DiagnosticCategory.Error]: 1,
  [ts.DiagnosticCategory.Warning]: 2,
  [ts.DiagnosticCategory.Message]: 3,
  [ts.DiagnosticCategory.Suggestion]: 4,
};

/**
 * TSのDiagnosticCategoryをLSPのDiagnosticSeverityに変換
 */
export function getDiagnosticSeverity(category) {
  return DiagnosticSeverityMap[category] || 1; // Default: Error
}
