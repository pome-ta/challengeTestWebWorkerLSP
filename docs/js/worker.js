// worker.js
// v0.0.2.0

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const DEBUG = true;

const postLog = (message) => {
  DEBUG && self.postMessage({type: 'log', message});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

postLog('👷 worker.js loaded');

// global cache: VFSのMapを保持し共用
let cachedDefaultMap = null;

async function safeCreateDefaultMap(
  retryCount = 3,
  perAttemptTimeoutMs = 5000
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    postLog(`🔄 VFS init attempt ${attempt}/${retryCount}`);
  
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

      postLog(`📦 defaultMap size: ${defaultMap.size}`);
      return defaultMap; // 成功したら返す
    } catch (error) {
      lastError = error;
      if (
        error.message.includes('fetch') ||
        error.message.includes('NetworkError')
      ) {
        postLog(`🚫 Network error: ${error.message}`);
        throw error; // ネットワーク系は諦める
      } else if (error.message.includes('timeout')) {
        postLog(`⏰ Timeout, retrying...`);
        await sleep(1000 * attempt); // リトライ間隔を少し伸ばす
        continue;
      } else {
        postLog(`❌ Unknown error: ${error.message}`);
        throw error;
      }
    }
  }

  throw lastError || new Error('VFS init failed after retries');
}


// ============================================================
// webWorker 処理
// ============================================================
self.addEventListener('message', async (event) => {
  const {data} = event;
  
  // ============================================================
  // Phase 1: 初期化 (Initialize)
  // ============================================================
  if (data === 'initialize') {
    postLog('🚀 initialize start');
    try {
      // すでにキャッシュがあれば再利用
      // (あるいは再生成も可だが今回は再利用)
      if (!cachedDefaultMap) {
        cachedDefaultMap = await safeCreateDefaultMap(3);
      } else {
        postLog('📦 Using existing cachedDefaultMap');
      }

      // 初期化完了通知
      self.postMessage({ type: 'response', message: 'vfs-ready' });
      postLog('✅ initialize complete: vfs-ready');

    } catch (error) {
      postLog(`❌ initialize error: ${error.message}`);
      self.postMessage({ type: 'error', message: error.message });
    }
    return;
  }
  
  // ============================================================
  // Phase 2: テスト実行 (キャッシュ済みMapを使用)
  // ============================================================
  // 共通: まだ初期化されていない場合のガード
  if (!cachedDefaultMap) {
    postLog(`❌ Error: Received ${data} but Worker is NOT initialized.`);
    self.postMessage({ type: 'error', message: 'Not initialized. Send "initialize" first.' });
    return;
  }
  

  if (data === 'vfs-update-recheck-test') {
    postLog('💻 vfs-update-recheck-test start');
    try {
      const system = vfs.createSystem(cachedDefaultMap);
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
      };
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);
      postLog('🧠 env created');
  
      const entry = '/main.ts';
      env.createFile(entry, `const x: number = 1;`);
      postLog('📝 created /main.ts with valid code');
  
      const before = env.languageService.getSemanticDiagnostics(entry).length;
      postLog(`🔍 diagnostics before update: ${before}`);
  
      env.updateFile(entry, `const x: string = 1;`);
      postLog('✏️ updated /main.ts (type mismatch)');
  
      const after = env.languageService.getSemanticDiagnostics(entry).length;
      postLog(`🔍 diagnostics after update: ${after}`);
  
      const passed = before === 0 && after > 0;
      postLog(passed ? '✅ update-recheck logic OK' : '❌ update-recheck logic failed');
  
      self.postMessage({
        type: 'response',
        message: {
          test: 'vfs-update-recheck-test',
          before,
          after,
          status: passed ? 'ok' : 'fail',
        },
      });
    } catch (error) {
      postLog(`❌ vfs-update-recheck-test error: ${error.message}`);
      self.postMessage({
        type: 'error',
        message: `vfs-update-recheck-test failed: ${error.message}`,
      });
    }
  }

  if (data === 'vfs-circular-import-test') {
    postLog('💻 vfs-circular-import-test start');
    try {
      const system = vfs.createSystem(cachedDefaultMap);
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      };
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);
      postLog('🧠 env created');
  
      // ファイルを相互 import
      env.createFile('/a.ts', `import { b } from './b'; export const a = b + 1;`);
      env.createFile('/b.ts', `import { a } from './a'; export const b = a + 1;`);
      const entry = '/a.ts';
      postLog('📝 created /a.ts and /b.ts (circular imports)');
  
      const diagnostics = env.languageService.getSemanticDiagnostics(entry);
      const count = diagnostics.length;
      postLog(`🔍 diagnostics count: ${count}`);
  
      const passed = count > 0;
      postLog(passed ? '✅ circular-import logic OK' : '❌ circular-import logic failed');
  
      self.postMessage({
        type: 'response',
        message: { test: 'vfs-circular-import-test', count, status: passed ? 'ok' : 'fail' },
      });
    } catch (error) {
      postLog(`❌ vfs-circular-import-test error: ${error.message}`);
      self.postMessage({
        type: 'error',
        message: `vfs-circular-import-test failed: ${error.message}`,
      });
    }
  }


  if (data === 'vfs-missing-import-test') {
    postLog('💻 vfs-missing-import-test start');
    try {
      const system = vfs.createSystem(cachedDefaultMap);
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      };
  
      const entry = '/main.ts';
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);
      postLog('🧠 env created');
  
      // 存在しないファイルを import
      env.createFile(entry, `import { foo } from './not-exist'; console.log(foo);`);
      postLog('📝 created /main.ts with missing import');
  
      const diags = env.languageService.getSemanticDiagnostics(entry);
      const hasImportError = diags.some(d => d.messageText.includes('Cannot find module'));
  
      postLog(`🔍 diagnostics count: ${diags.length}`);
      postLog(hasImportError ? '✅ missing-import logic OK' : '❌ missing-import logic failed');
  
      self.postMessage({
        type: 'response',
        message: {
          test: 'vfs-missing-import-test',
          status: hasImportError ? 'ok' : 'fail',
          diagnostics: diags.map(d => d.messageText),
        },
      });
    } catch (error) {
      postLog(`❌ vfs-missing-import-test error: ${error.message}`);
      self.postMessage({
        type: 'error',
        message: `vfs-missing-import-test failed: ${error.message}`,
      });
    }
  }
  

  if (data === 'vfs-delete-test') {
    postLog('💻 vfs-delete-test start');
    try {
      // 1. VFS初期化
      const system = vfs.createSystem(cachedDefaultMap);
  
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowArbitraryExtensions: true,
        allowJs: true,
        checkJs: true,
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
      };
  
      const entry = '/main.ts';
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);
      postLog('🧠 env created');
  
      // 2. ファイル作成
      env.createFile('/a.ts', `export const msg = "hello";`);
      env.createFile(entry, `import { msg } from "./a"; console.log(msg);`);
      postLog('📝 created /a.ts and /main.ts in env');
  
      // 3. 削除前診断
      const before = env.languageService.getSemanticDiagnostics(entry).length;
      postLog(`🔍 diagnostics before: ${before}`);
  
      // 4. ファイル削除
      env.deleteFile('/a.ts');
      postLog('🗑️ deleted /a.ts');
  
      // 5. 削除後診断
      const diagnosticsAfter = env.languageService.getSemanticDiagnostics(entry);
      const after = diagnosticsAfter.length;
      postLog(`🔍 diagnostics after: ${after}`);
  
      // 6. 結果評価
      const hasImportError = diagnosticsAfter.some(d => d.code === 2307);
      const passed = before === 0 && after > 0 && hasImportError;
      postLog(passed ? '✅ vfs-delete logic OK' : '❌ vfs-delete logic failed');
  
      // 7. 結果送信
      self.postMessage({
        type: 'response',
        message: {
          test: 'vfs-delete-test',
          entry,
          before,
          after,
          status: passed ? 'ok' : 'fail',
          errorCode: hasImportError ? 'TS2307' : null,
        },
      });
    } catch (error) {
      postLog(`❌ vfs-delete-test error: ${error.message}`);
      self.postMessage({
        type: 'error',
        message: `vfs-delete-test failed: ${error.message}`,
      });
    }
  }

  if (data === 'vfs-multi-file-test') {
    postLog('💻 vfs-multi-file-test start');
    try {
      const system = vfs.createSystem(cachedDefaultMap);
  
      // ファイルを system に書くのではなく env 後に createFile で登録する
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022, // 生成するJSのバージョンを指定。'ES2015'以上でないとプライベート識別子(#)などでエラー
        moduleResolution: ts.ModuleResolutionKind.Bundler, // URLベースのimportなど、モダンなモジュール解決を許可する
        allowArbitraryExtensions: true, // .js や .ts 以外の拡張子を持つファイルをインポートできるようにする
        allowJs: true, // .js ファイルのコンパイルを許可する
        checkJs: true, // .js ファイルに対しても型チェックを行う (JSDocと連携)
        strict: true, // すべての厳格な型チェックオプションを有効にする (noImplicitAnyなどを含む)
        noUnusedLocals: true, // 未使用のローカル変数をエラーとして報告する
        noUnusedParameters: true, // 未使用の関数パラメータをエラーとして報告する
      };
  
      const entry = '/main.ts';
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);
      postLog('🧠 env created');
  
      // env 経由でファイルを追加
      env.createFile('/a.ts', `export const foo = 1;`);
      env.createFile(entry, `import { foo } from './a'; console.log(foo);`);
      postLog('📝 created /a.ts and /main.ts in env');
  
      const before = env.languageService.getSemanticDiagnostics(entry).length;
      postLog(`🔍 diagnostics before: ${before}`);
  
      // ファイル内容を updateFile 経由で壊す(キャッシュが更新される)
      env.updateFile('/a.ts', `// export const foo = 1;`);
      const after = env.languageService.getSemanticDiagnostics(entry).length;
      postLog(`🔍 diagnostics after: ${after}`);
  
      const passed = before === 0 && after > 0;
      postLog(passed ? '✅ multi-file logic OK' : '❌ multi-file logic failed');
  
      self.postMessage({
        type: 'response',
        message: {
          test: 'vfs-multi-file-test',
          entry,
          before,
          after,
          status: passed ? 'ok' : 'fail',
        },
      });
    } catch (error) {
      postLog(`❌ vfs-multi-file-test error: ${error.message}`);
      self.postMessage({
        type: 'error',
        message: `vfs-multi-file-test failed: ${error.message}`,
      });
    }
  }

  if (data === 'vfs-file-test') {
    postLog('💻 vfs-file-test start');
    try {
      // defaultMap と env の初期化
      postLog(`📦 cachedDefaultMap size: ${cachedDefaultMap.size}`);
  
      const system = vfs.createSystem(cachedDefaultMap);
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowArbitraryExtensions: true,
        allowJs: true,
        checkJs: true,
        strict: true,
      };
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);
  
      postLog('🧠 env created');
      // ファイル作成: 型エラーを意図的に含める (semantic diagnostics を確認するため)
      const filePath = 'hello.ts';
      const initialText = `// test\nconst x: number = "this-is-a-string";\n`;
      env.createFile(filePath, initialText);
      postLog(`📝 created ${filePath}`);
  
      // 診断取得 (semantic)
      const diags = env.languageService.getSemanticDiagnostics(filePath);
      postLog(`🔍 diagnostics count after create: ${diags.length}`);
  
      // updateFile で修正(オプション: 正常化して診断が0になることも検証可能)
      const fixedText = `// test\nconst x: number = 123;\n`;
      env.updateFile(filePath, fixedText);
      postLog(`✏️ updated ${filePath}`);
  
      const diagsAfter = env.languageService.getSemanticDiagnostics(filePath);
      postLog(`🔍 diagnostics count after update: ${diagsAfter.length}`);
  
      // レスポンス: 診断数などを返す
      self.postMessage({
        type: 'response',
        message: {
          status: 'ok',
          file: filePath,
          diagnosticsCountBefore: diags.length,
          diagnosticsCountAfter: diagsAfter.length,
        },
      });
      postLog('📤 vfs-file-test response sent');
    } catch (error) {
      postLog(`❌ vfs-file-test error: ${error.message}`);
      self.postMessage({ type: 'error', message: error.message });
    }
  }
  
  if (data === 'vfs-env-test') {
    postLog('💻 vfs-env-test start');
    try {
      const system = vfs.createSystem(cachedDefaultMap);
      
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022, // 生成するJSのバージョンを指定。'ES2015'以上でないとプライベート識別子(#)などでエラー
        moduleResolution: ts.ModuleResolutionKind.Bundler, // URLベースのimportなど、モダンなモジュール解決を許可する
        allowArbitraryExtensions: true, // .js や .ts 以外の拡張子を持つファイルをインポートできるようにする
        allowJs: true, // .js ファイルのコンパイルを許可する
        checkJs: true, // .js ファイルに対しても型チェックを行う (JSDocと連携)
        strict: true, // すべての厳格な型チェックオプションを有効にする (noImplicitAnyなどを含む)
        noUnusedLocals: true, // 未使用のローカル変数をエラーとして報告する
        noUnusedParameters: true, // 未使用の関数パラメータをエラーとして報告する
      };
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, compilerOptions);
      
       // ファイル作成
      env.createFile('hello.ts', 'const x: number = "string";');
      // 構文解析
      const diagnostics = env.languageService.getSemanticDiagnostics('hello.ts');
      // テスト結果を返す
      
      // name, sys, languageService, getSourceFile, createFile, updateFile, deleteFile
      postLog(`🧠 env keys: ${Object.keys(env).join(', ')}`);
      

      // テスト結果を返す
      self.postMessage({
        type: 'response',
        message: {
          status: 'ok',
          diagnosticsCount: diagnostics.length,
        },
      });
    } catch (error) {
      postLog(`❌ vfs-env-test error: ${error.message}`);
      self.postMessage({ type: 'error', message: error.message });
    }
  }


  if (data === 'vfs-init') {
    postLog('💻 vfs-init start');

    try {
      // Safari 対策: postMessage 直後の GC 回避
      setTimeout(() => {
        try {
          self.postMessage({type: 'response', message: 'return'});
          postLog('📤 vfs-init response sent (delayed)');
        } catch (error) {
          postLog(`⚠️ vfs-init postMessage failed: ${error.message}`);
        }
      }, 50);
    } catch (error) {
      postLog(`❌ vfs-init error: ${error.message}`);
      self.postMessage({type: 'error', message: error.message});
    }
  }

  if (data === 'ping') {
    postLog('📡 Received: ping');
    self.postMessage({type: 'response', message: 'pong'});
  }

  if (data === 'shutdown') {
    postLog('👋 Worker shutting down...');
    self.postMessage({type: 'response', message: 'shutdown-complete'});
    // ログ送信を少し待つ
    setTimeout(() => self.close(), 100);
  }
});

// ready 通知
self.postMessage({type: 'ready'});
