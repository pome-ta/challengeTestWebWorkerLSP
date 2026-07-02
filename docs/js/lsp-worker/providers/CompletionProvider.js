import ts from 'https://esm.sh/typescript';
import { getCompletionItemKind } from '../mappers/completionKind.js';
import { postLog } from '../logger.js';

export class CompletionProvider {
  #tsEnv;
  constructor(tsEnv) {
    this.#tsEnv = tsEnv;
  }

  async handle(params) {
    const { uri } = params.textDocument;
    const { position } = params;

    const sourceFile = this.#tsEnv.getSourceFile(uri);
    if (!sourceFile) return null;

    const offset = ts.getPositionOfLineAndCharacter(sourceFile, position.line, position.character);

    try {
      const completions = this.#tsEnv.getLanguageService().getCompletionsAtPosition(uri, offset, {
        includeCompletionsForModuleExports: false,
        includeCompletionsWithInsertText: true,
      });

      if (!completions || !completions.entries) return null;

      const items = completions.entries.map((entry) => ({
        label: entry.name,
        kind: getCompletionItemKind(entry.kind),
        sortText: entry.sortText,
        insertText: entry.insertText,
      }));

      return { isIncomplete: false, items };
    } catch (e) {
      postLog(`Completion error: ${e.message}`, 1);
      return null;
    }
  }
}
