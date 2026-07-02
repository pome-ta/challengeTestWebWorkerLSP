import ts from 'https://esm.sh/typescript';

const CompletionItemKindMap = {
  [ts.ScriptElementKind.primitiveType]: 14,
  [ts.ScriptElementKind.keyword]: 14,
  [ts.ScriptElementKind.constElement]: 21,
  [ts.ScriptElementKind.letElement]: 6,
  [ts.ScriptElementKind.variableElement]: 6,
  [ts.ScriptElementKind.localVariableElement]: 6,
  [ts.ScriptElementKind.classElement]: 7,
  [ts.ScriptElementKind.interfaceElement]: 8,
  [ts.ScriptElementKind.typeElement]: 25,
  [ts.ScriptElementKind.enumElement]: 13,
  [ts.ScriptElementKind.functionElement]: 3,
  [ts.ScriptElementKind.localFunctionElement]: 3,
  [ts.ScriptElementKind.memberFunctionElement]: 2,
  [ts.ScriptElementKind.memberGetAccessorElement]: 5,
  [ts.ScriptElementKind.memberSetAccessorElement]: 5,
  [ts.ScriptElementKind.memberVariableElement]: 5,
  [ts.ScriptElementKind.moduleElement]: 9,
  [ts.ScriptElementKind.string]: 1,
};

/**
 * TSのKindをLSPのCompletionItemKind(数値)に変換
 */
export function getCompletionItemKind(tsKind) {
  return CompletionItemKindMap[tsKind] || 10; // Default: Property
}
