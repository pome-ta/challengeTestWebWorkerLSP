// worker.js
// v0.0.1.2

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

const DEBUG = true;

const postLog = (message) => {
  DEBUG && self.postMessage({type: 'log', message});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

postLog('👷 worker.js loaded');

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

self.addEventListener('message', async (event) => {
  const {data} = event;





  if (data === 'vfs-multi-file-test') {
    postLog('💻 vfs-multi-file-test start');
    try {
      const defaultMap = await safeCreateDefaultMap(3);
      const system = vfs.createSystem(defaultMap);
  
      // -------------- ファイル配置(env作成前に必ず行う) --------------
      // 明確なエントリポイント名を使う: /main.ts
      system.writeFile('/a.ts', `export const foo = 1;`);
      system.writeFile('/main.ts', `import { foo } from './a'; console.log(foo);`);
      postLog('📝 created /a.ts and /main.ts in VFS');
  
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowJs: true,
        checkJs: true,
        strict: true,
      };
  
      // env作成時にエントリを渡す → 言語サービスのプログラムに確実に含まれる
      const entry = '/main.ts';
      const env = vfs.createVirtualTypeScriptEnvironment(
        system,
        [entry],
        ts,
        compilerOptions
      );
      postLog('🧠 env created');
  
      // --- 初期診断(エントリ側) ---
      const before = env.languageService.getSemanticDiagnostics(entry).length;
      postLog(`🔍 diagnostics before: ${before}`);
  
      // --- 意図的に a.ts を壊してエラーを誘発(エントリに影響) ---
      // export をコメントアウトすることで main.ts の import が壊れる
      system.writeFile('/a.ts', `// export const foo = 1;`);
      // 言語サービスのキャッシュがある場合に備え、言語サービス呼び出し直後の反映を期待
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
      const defaultMap = await safeCreateDefaultMap(3);
      postLog(`📦 defaultMap size: ${defaultMap.size}`);
  
      const system = vfs.createSystem(defaultMap);
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
      const defaultMap = await safeCreateDefaultMap(3);

      const system = vfs.createSystem(defaultMap);
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
      const defaultMap = await safeCreateDefaultMap(3);
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
    // ログ送信を少し待つ
    setTimeout(() => self.close(), 100);
  }
});

// ready 通知
self.postMessage({type: 'ready'});
