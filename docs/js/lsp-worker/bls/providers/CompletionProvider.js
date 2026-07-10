import { getCompletionItemKind } from '../mappers/completionKind.js';
import { postLog } from '../../logger.js';

export class CompletionProvider {
  #tsEnv;
  constructor(tsEnv) {
    this.#tsEnv = tsEnv;
  }

  async handle(params) {
    const { uri } = params.textDocument;
    const { position } = params;

    try {
      const completions = this.#tsEnv.getCompletions(uri, position);
      if (!completions || !completions.entries) {
        return null;
      }

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
