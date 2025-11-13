// core/vfs-core.js
// v0.0.2.0-core-vfs
//
// Exports:
//  - safeCreateDefaultMap(logger, retryCount?, perAttemptTimeoutMs?) => Promise<Map>
//  - createEnv(defaultMap, ts, options) => { system, env, compilerOptions }
//  - tests: runVfsInit, runFileTest, runMultiFileTest, runDeleteTest, runMissingImportTest, runCircularImportTest, runUpdateRecheckTest
//
// All functions accept a logger callback (msg:string) to report progress.
// Designed to be imported and used from a Worker module.

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const DEFAULT_PER_ATTEMPT_MS = 5000;
const DEFAULT_RETRY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * safeCreateDefaultMap
 * @param {(msg:string)=>void} logger
 * @param {number} retryCount
 * @param {number} perAttemptTimeoutMs
 * @returns {Promise<Map>}
 */
export const safeCreateDefaultMap = async (
  logger = () => {},
  retryCount = DEFAULT_RETRY,
  perAttemptTimeoutMs = DEFAULT_PER_ATTEMPT_MS
) => {
  let lastError = null;
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    logger(`🔄 VFS init attempt ${attempt}/${retryCount}`);
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), perAttemptTimeoutMs)
      );
      const defaultMap = await Promise.race([
        vfs.createDefaultMapFromCDN(
          {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
          ts.version,
          false,
          ts
        ),
        timeout,
      ]);
      logger(`📦 defaultMap size: ${defaultMap.size}`);
      return defaultMap;
    } catch (error) {
      lastError = error;
      const msg = String(error?.message ?? error);
      if (msg.includes('fetch') || msg.includes('NetworkError')) {
        logger(`🚫 Network error: ${msg}`);
        throw error;
      } else if (msg.includes('timeout')) {
        logger(`⏰ Timeout, retrying...`);
        await sleep(1000 * attempt);
        continue;
      } else {
        logger(`❌ Unknown error: ${msg}`);
        throw error;
      }
    }
  }
  throw lastError || new Error('VFS init failed after retries');
};

/**
 * createEnv - wrap createSystem + createVirtualTypeScriptEnvironment
 * @param {Map} defaultMap
 * @param {object} tsImpl
 * @param {object} options - compilerOptions that will be passed
 * @returns {{system: any, env: any, compilerOptions: object}}
 */
export const createEnv = (defaultMap, tsImpl, options = {}) => {
  const system = vfs.createSystem(defaultMap);
  const compilerOptions = {
    target: tsImpl.ScriptTarget.ES2022,
    moduleResolution: tsImpl.ModuleResolutionKind.Bundler,
    allowArbitraryExtensions: true,
    allowJs: true,
    checkJs: true,
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    ...options,
  };
  const env = vfs.createVirtualTypeScriptEnvironment(system, [], tsImpl, compilerOptions);
  return { system, env, compilerOptions };
};

/* ---------- VFS convenience tests (return objects, logger used for progress) ---------- */

/**
 * runVfsInit - simply initializes defaultMap and returns metadata
 * @param {(m:string)=>void} logger
 */
export const runVfsInit = async (logger = () => {}) => {
  const defaultMap = await safeCreateDefaultMap(logger);
  return { count: defaultMap.size, hasLibDom: defaultMap.has('lib.dom.d.ts') };
};

/**
 * runFileTest - create single file with semantic error then fix it
 */
export const runFileTest = async (logger = () => {}) => {
  const defaultMap = await safeCreateDefaultMap(logger);
  const { env } = createEnv(defaultMap, ts);
  logger('🧠 env created');

  const filePath = 'hello.ts';
  const initialText = `// test\nconst x: number = "this-is-a-string";\n`;
  env.createFile(filePath, initialText);
  logger(`📝 created ${filePath}`);

  const diagsBefore = env.languageService.getSemanticDiagnostics(filePath).length;
  logger(`🔍 diagnostics count after create: ${diagsBefore}`);

  const fixedText = `// test\nconst x: number = 123;\n`;
  env.updateFile(filePath, fixedText);
  logger(`✏️ updated ${filePath}`);

  const diagsAfter = env.languageService.getSemanticDiagnostics(filePath).length;
  logger(`🔍 diagnostics count after update: ${diagsAfter}`);

  return { file: filePath, before: diagsBefore, after: diagsAfter };
};

/**
 * runMultiFileTest - create /a.ts and /main.ts and mutate a.ts to cause error in entry
 */
export const runMultiFileTest = async (logger = () => {}) => {
  const defaultMap = await safeCreateDefaultMap(logger);
  const { env } = createEnv(defaultMap, ts);
  logger('🧠 env created');

  const entry = '/main.ts';
  env.createFile('/a.ts', `export const foo = 1;`);
  env.createFile(entry, `import { foo } from './a'; console.log(foo);`);
  logger('📝 created /a.ts and /main.ts in env');

  const before = env.languageService.getSemanticDiagnostics(entry).length;
  logger(`🔍 diagnostics before: ${before}`);

  env.updateFile('/a.ts', `// export const foo = 1;`);
  logger('✏️ updated /a.ts (commented export)');

  const after = env.languageService.getSemanticDiagnostics(entry).length;
  logger(`🔍 diagnostics after: ${after}`);

  return { entry, before, after };
};

/**
 * runDeleteTest - create a.ts + entry then delete a.ts -> expect diagnostics
 */
export const runDeleteTest = async (logger = () => {}) => {
  const defaultMap = await safeCreateDefaultMap(logger);
  const { env } = createEnv(defaultMap, ts);
  logger('🧠 env created');

  const entry = '/main.ts';
  env.createFile('/a.ts', `export const msg = "hello";`);
  env.createFile(entry, `import { msg } from "./a"; console.log(msg);`);
  logger('📝 created /a.ts and /main.ts in env');

  const before = env.languageService.getSemanticDiagnostics(entry).length;
  logger(`🔍 diagnostics before: ${before}`);

  env.deleteFile('/a.ts');
  logger(`🗑️ deleted /a.ts`);

  const diagnosticsAfter = env.languageService.getSemanticDiagnostics(entry);
  const after = diagnosticsAfter.length;
  logger(`🔍 diagnostics after: ${after}`);

  const hasImportError = diagnosticsAfter.some((d) => d.code === 2307);
  return { entry, before, after, hasImportError };
};

/**
 * runMissingImportTest - entry imports non-existent module -> expect import error
 */
export const runMissingImportTest = async (logger = () => {}) => {
  const defaultMap = await safeCreateDefaultMap(logger);
  const { env } = createEnv(defaultMap, ts);
  logger('🧠 env created');

  const entry = '/main.ts';
  env.createFile(entry, `import { foo } from './not-exist'; console.log(foo);`);
  logger('📝 created /main.ts with missing import');

  const diags = env.languageService.getSemanticDiagnostics(entry);
  const hasImportError = diags.some((d) =>
    String(d.messageText).includes('Cannot find module') || d.code === 2307
  );
  logger(`🔍 diagnostics count: ${diags.length}`);

  return { entry, count: diags.length, hasImportError };
};

/**
 * runCircularImportTest - create a<->b circular imports and check diagnostics
 */
export const runCircularImportTest = async (logger = () => {}) => {
  const defaultMap = await safeCreateDefaultMap(logger);
  const { env } = createEnv(defaultMap, ts);
  logger('🧠 env created');

  env.createFile('/a.ts', `import { b } from './b'; export const a = b + 1;`);
  env.createFile('/b.ts', `import { a } from './a'; export const b = a + 1;`);
  logger('📝 created /a.ts and /b.ts (circular imports)');

  const diagnostics = env.languageService.getSemanticDiagnostics('/a.ts');
  const count = diagnostics.length;
  logger(`🔍 diagnostics count: ${count}`);
  return { entry: '/a.ts', count };
};

/**
 * runUpdateRecheckTest - create entry, no-diag -> update to produce diag
 */
export const runUpdateRecheckTest = async (logger = () => {}) => {
  const defaultMap = await safeCreateDefaultMap(logger);
  const { env } = createEnv(defaultMap, ts);
  logger('🧠 env created');

  const entry = '/main.ts';
  env.createFile(entry, `const x: number = 1;`);
  logger('📝 created /main.ts with valid code');

  const before = env.languageService.getSemanticDiagnostics(entry).length;
  logger(`🔍 diagnostics before update: ${before}`);

  env.updateFile(entry, `const x: string = 1;`);
  logger('✏️ updated /main.ts (type mismatch)');

  const after = env.languageService.getSemanticDiagnostics(entry).length;
  logger(`🔍 diagnostics after update: ${after}`);

  const passed = before === 0 && after > 0;
  return { entry, before, after, status: passed ? 'ok' : 'fail' };
};