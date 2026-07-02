import ts from 'https://esm.sh/typescript';
import { postLog } from '../logger.js';

export class HoverProvider {
  #tsEnv;
  constructor(tsEnv) {
    this.#tsEnv = tsEnv;
  }

  async handle(params) {
    const { uri } = params.textDocument;
    const { position } = params;

    const sourceFile = this.#tsEnv.getSourceFile(uri);
    if (!sourceFile) {
      return null;
    }

    const offset = ts.getPositionOfLineAndCharacter(sourceFile, position.line, position.character);

    try {
      const info = this.#tsEnv.getLanguageService().getQuickInfoAtPosition(uri, offset);
      if (!info) {
        return null;
      }

      const displayString = ts.displayPartsToString(info.displayParts || []);
      const docString = ts.displayPartsToString(info.documentation || []);

      const contents = {
        kind: 'markdown',
        value: [`\`\`\`typescript\n${displayString}\n\`\`\``, docString].filter(Boolean).join('\n\n---\n\n'),
      };

      const start = ts.getLineAndCharacterOfPosition(sourceFile, info.textSpan.start);
      const end = ts.getLineAndCharacterOfPosition(sourceFile, info.textSpan.start + info.textSpan.length);

      return { contents, range: { start, end } };
    } catch (e) {
      postLog(`Hover error: ${e.message}`, 1);
      return null;
    }
  }
}
