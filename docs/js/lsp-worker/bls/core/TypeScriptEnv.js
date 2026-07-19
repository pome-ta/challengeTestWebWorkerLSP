import ts from '../../esmCDN/typescript.js';
import * as tsvfs from '../../esmCDN/@typescript/vfs.js';
import { setupTypeAcquisition } from '../../esmCDN/@typescript/ata.js';

import { postLog } from '../../logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class TypeScriptEnv {
  #fsMap;
  #system;
  #env;
  #ata;
  #ataTimer = null;
  #onAtaFinished = null;

  #compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    allowArbitraryExtensions: true,
    allowJs: true,
    checkJs: true,
    noUnusedLocals: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
  };

  async init(onAtaFinishedCallback) {
    this.#onAtaFinished = onAtaFinishedCallback;
    postLog('TypeScriptEnv init start');

    this.#fsMap = await this.#createDefaultMapWithRetry();
    this.#system = tsvfs.createSystem(this.#fsMap);
    this.#env = tsvfs.createVirtualTypeScriptEnvironment(this.#system, [], ts, this.#compilerOptions);

    const files = [
      'package.json',
      'types/index.d.ts',
      /*
      'types/globals.d.ts',
      'types/core.d.ts',
      'types/sources.d.ts',
      'types/effects.d.ts',
      'types/analysis.d.ts',
      'types/deprecated.d.ts',
      */
    ];

    const baseURL = new URL('../../types/p5.sounda/', import.meta.url);

    const results = await Promise.all(
      files.map(async (file) => ({
        path: `file:///myTypes/p5.sounda/${file}`,
        text: await fetch(new URL(file, baseURL)).then((r) => r.text()),
      })),
    );

    for (const { path, text } of results) {
      this.createVirtualFile(path, text);
    }

    /*

    const soundPackage = 'p5.sound/package.json';
    const soundPackageURL = new URL(`../../types/${soundPackage}`, import.meta.url);
    const soundPackageStr = await fetch(soundPackageURL).then((r) => r.text());

    const soundDotTs = 'p5.sound/types/p5.sound.d.ts';
    const soundDotTsURL = new URL(`../../types/${soundDotTs}`, import.meta.url);
    const soundDotTsStr = await fetch(soundDotTsURL).then((r) => r.text());

    this.createVirtualFile(`file:///node_modules/${soundPackage}`, soundPackageStr);
    this.createVirtualFile(`file:///node_modules/${soundDotTs}`, soundDotTsStr);
    //this.createVirtualFile(`file:///types/${soundPackage}`, soundPackageStr);
    //this.createVirtualFile(`file:///types/${soundDotTs}`, soundDotTsStr);
    */

    const p5GlobalBridge = `
      import p5_module from 'p5';

      declare global {
        const p5: typeof p5_module;
        type p5 = p5_module;
      }
    `;
    //this.createVirtualFile('file:///p5-bridge.d.ts', p5GlobalBridge);
    //this.createVirtualFile('file:///types/p5-bridge.d.ts', p5GlobalBridge);

    this.#setupATA();
    this.#ata(`import 'p5';`);

    postLog('TypeScriptEnv init complete');
  }

  // =========================================================
  // Phase 2: Document と VirtualFile の分離
  // =========================================================

  updateDocument(uri, text) {
    const validText = text.trim() === '' ? '\n' : text;
    if (this.#env.getSourceFile(uri)) {
      this.#env.updateFile(uri, validText);
    } else {
      this.#env.createFile(uri, validText);
    }

    const program = this.#env.languageService.getProgram();
    const sf = program.getSourceFile('file:///main.js');

    //const typesp5 = program.getSourceFile('file:///node_modules/p5/types/p5.d.ts');
    postLog('👇typesp5');
    postLog(program.getSourceFile('file:///node_modules/p5/types/p5.d.ts')?.text.slice(0, 3000));

    /*
    
    postLog('👇getSourceFiles');
    postLog(
      program
        .getSourceFiles()
        .map((sf) => sf.fileName)
        .join('\n'),
    );
    */

    //postLog(`😊resolvedModules: ${sf.resolvedModules}`);

    /*
const outdiv = document.createElement('div');
const erudaShadow = document.getElementById('eruda').shadowRoot;
const lunaConsoleLogContents = erudaShadow.querySelectorAll('.luna-console-log-content');
lunaConsoleLogContents.forEach((content) => {
  outdiv.appendChild(content);
});
const innerText = outdiv.innerText;
const copyblock = '```' + '\n' + innerText + '\n' + '```';
navigator.clipboard.writeText(copyblock).then();
*/
  }

  closeDocument(uri) {
    if (this.#env.getSourceFile(uri)) {
      this.#env.deleteFile(uri);
    }
  }

  createVirtualFile(uri, text) {
    if (!this.#env.getSourceFile(uri)) {
      this.#env.createFile(uri, text);
    }
  }

  updateVirtualFile(uri, text) {
    if (this.#env.getSourceFile(uri)) {
      this.#env.updateFile(uri, text);
    } else {
      this.#env.createFile(uri, text);
    }
  }

  // =========================================================
  // Phase 1 & 3: LanguageService の隠蔽と API の公開
  // =========================================================

  #getOffset(uri, position) {
    const sourceFile = this.#env.getSourceFile(uri);
    if (!sourceFile) {
      return null;
    }
    return ts.getPositionOfLineAndCharacter(sourceFile, position.line, position.character);
  }

  #getPosition(uri, offset) {
    const sourceFile = this.#env.getSourceFile(uri);
    if (!sourceFile) {
      return null;
    }
    return ts.getLineAndCharacterOfPosition(sourceFile, offset);
  }

  getHoverInfo(uri, position) {
    const offset = this.#getOffset(uri, position);
    if (offset === null) {
      return null;
    }

    const info = this.#env.languageService.getQuickInfoAtPosition(uri, offset);
    if (!info) {
      return null;
    }

    return {
      displayString: ts.displayPartsToString(info.displayParts || []),
      docString: ts.displayPartsToString(info.documentation || []),
      range: {
        start: this.#getPosition(uri, info.textSpan.start),
        end: this.#getPosition(uri, info.textSpan.start + info.textSpan.length),
      },
    };
  }

  getCompletions(uri, position) {
    const offset = this.#getOffset(uri, position);
    if (offset === null) {
      return null;
    }

    return this.#env.languageService.getCompletionsAtPosition(uri, offset, {
      includeCompletionsForModuleExports: false,
      includeCompletionsWithInsertText: true,
    });
  }

  getDiagnostics(uri) {
    const syntactic = this.#env.languageService.getSyntacticDiagnostics(uri);
    const semantic = this.#env.languageService.getSemanticDiagnostics(uri);

    return [...syntactic, ...semantic].map((diag) => {
      const startOffset = diag.start ?? 0;
      const endOffset = startOffset + (diag.length ?? 0);
      return {
        range: {
          start: this.#getPosition(uri, startOffset),
          end: this.#getPosition(uri, endOffset),
        },
        category: diag.category,
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
        code: diag.code,
      };
    });
  }

  // =========================================================
  // ATA と 内部モジュール API
  // =========================================================

  triggerATA(text) {
    if (this.#ataTimer) {
      clearTimeout(this.#ataTimer);
    }
    this.#ataTimer = setTimeout(() => {
      postLog('Triggering ATA parsing...', 4);
      this.#ata(text);
    }, 1000);
  }

  #setupATA() {
    this.#ata = setupTypeAcquisition({
      projectName: 'browser-lsp',
      typescript: ts,
      logger: {
        log: (msg) => postLog(`[ATA] ${msg}`, 4),
        error: (msg) => postLog(`[ATA Error] ${msg}`, 1),
        warn: (msg) => postLog(`[ATA Warn] ${msg}`, 2),
        info: (msg) => postLog(`[ATA Info] ${msg}`, 3),
      },
      delegate: {
        receivedFile: (code, path) => {
          const vfsPath = `file://${path}`;
          postLog(`[ATA] Injected: ${path}`, 4);
          this.updateVirtualFile(vfsPath, code); // VirtualFileとして更新
        },
        finished: () => {
          postLog(`[ATA] Finished downloading types.`, 3);
          if (this.#onAtaFinished) this.#onAtaFinished();
        },
      },
    });
  }

  //   #injectInternalModules() {
  //     this.createVirtualFile(
  //       'file:///src/utils/math.ts',
  //       `
  // export function add(a: number, b: number) { return a + b; }
  // export function hogehoge(a: number, b: number) { return a + b; }
  //       `,
  //     );
  //     postLog('[Env Init] Injected internal module: math.ts', 4);
  //   }

  async #createDefaultMapWithRetry(retryCount = 3, perAttemptTimeoutMs = 8000) {
    let lastError = null;
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      postLog(`VFS lib fetch attempt ${attempt}/${retryCount}`);
      try {
        const result = await Promise.race([
          tsvfs.createDefaultMapFromCDN(this.#compilerOptions, ts.version, false, ts),
          new Promise((_, r) => setTimeout(() => r(new Error('timeout')), perAttemptTimeoutMs)),
        ]);
        postLog(`VFS lib fetch success size=${result.size}`);
        return result;
      } catch (err) {
        lastError = err;
        const msg = String(err?.message ?? err);
        if (msg.includes('NetworkError')) {
          throw err;
        }
        if (msg.includes('timeout')) {
          await sleep(1000 * attempt);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('VFS default map initialization failed');
  }
}
