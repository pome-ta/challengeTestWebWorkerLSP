import ts from 'https://esm.sh/typescript';

/**
 * TSのKindをLSPのCompletionItemKind(数値)に変換
 */
export function getCompletionItemKind(tsKind) {
  switch (tsKind) {
    case ts.ScriptElementKind.primitiveType:
    case ts.ScriptElementKind.keyword:
      return 14; // Keyword
    case ts.ScriptElementKind.constElement:
      return 21; // Constant
    case ts.ScriptElementKind.letElement:
    case ts.ScriptElementKind.variableElement:
    case ts.ScriptElementKind.localVariableElement:
      return 6; // Variable
    case ts.ScriptElementKind.classElement:
      return 7; // Class
    case ts.ScriptElementKind.interfaceElement:
      return 8; // Interface
    case ts.ScriptElementKind.typeElement:
      return 25; // TypeParameter
    case ts.ScriptElementKind.enumElement:
      return 13; // Enum
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.localFunctionElement:
      return 3; // Function
    case ts.ScriptElementKind.memberFunctionElement:
      return 2; // Method
    case ts.ScriptElementKind.memberGetAccessorElement:
    case ts.ScriptElementKind.memberSetAccessorElement:
    case ts.ScriptElementKind.memberVariableElement:
      return 5; // Field
    case ts.ScriptElementKind.moduleElement:
      return 9; // Module
    case ts.ScriptElementKind.string:
      return 1; // Text
    default:
      return 10; // Property
  }
}

/**
 * TSのDiagnosticCategoryをLSPのDiagnosticSeverityに変換
 */
export function getDiagnosticSeverity(category) {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 1; // Error
    case ts.DiagnosticCategory.Warning:
      return 2; // Warning
    case ts.DiagnosticCategory.Message:
      return 3; // Information
    case ts.DiagnosticCategory.Suggestion:
      return 4; // Hint
    default:
      return 1;
  }
}
