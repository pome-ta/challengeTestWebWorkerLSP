import { postLog } from '../../logger.js';

export class HoverProvider {
  #tsEnv;
  constructor(tsEnv) {
    this.#tsEnv = tsEnv;
  }

  async handle(params) {
    const { uri } = params.textDocument;
    const { position } = params;

    try {
      // TSに依存せず、必要な情報を Facade(Env) からもらうだけ
      const info = this.#tsEnv.getHoverInfo(uri, position);
      if (!info) {
        return null;
      }

      const contents = {
        kind: 'markdown',
        value: [`\`\`\`typescript\n${info.displayString}\n\`\`\``, info.docString].filter(Boolean).join('\n\n---\n\n'),
      };

      return { contents, range: info.range };
    } catch (e) {
      postLog(`Hover error: ${e.message}`, 1);
      return null;
    }
  }
}
