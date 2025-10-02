// worker.js (module Worker)
//  - JSON-RPC (文字列) を受け取り、TypeScript 言語サービス経由で補完/診断を返す最小実装
//  - 内部で @typescript/vfs と typescript を CDN から動的 import して初期化する
//  - メッセージのやり取りはすべて JSON.stringify/parse した文字列で行う(LSP に近い流儀)

// モジュールレベルの状態
let env = null;            // createVirtualTypeScriptEnvironment が返す環境
let tsModule = null;       // typescript モジュール参照
let initialized = false;   // boot 実行済フラグ
const fileContents = new Map(); // path -> text

// --- ログを main に転送するユーティリティ ---
// main 側で受け取れるように { method: 'log', params: '...' } 形式で送る
function sendLog(...args) {
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  self.postMessage(JSON.stringify({ method: 'log', params: msg }));
}
// override console.log して開発時のログを main に出す(eruda や main の console で見える)
console.log = (...args) => sendLog('[worker b]', ...args);

// --- send helpers (JSON-RPC 風で文字列を送る) ---
function sendResponse(id, result) {
  self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
}
function sendError(id, code, message) {
  self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}
function sendNotification(method, params) {
  self.postMessage(JSON.stringify({ jsonrpc: '2.0', method, params }));
}

// --- vfs + TypeScript 環境の初期化 ---
// boot() を await してから言語サービス API を呼んでください
async function boot() {
  if (initialized) return;
  // 動的 import: CDN (esm.sh) から読み込む(初回はネットワークアクセスあり)
  // 注意: URL は必要に応じてバージョン固定してください(安定化のため)。
  const vfs = await import('https://esm.sh/@typescript/vfs');
  tsModule = await import('https://esm.sh/typescript');

  // createDefaultMapFromCDN に TypeScript を渡して lib ファイルを取得
  const defaultMap = await vfs.createDefaultMapFromCDN({ target: tsModule.ScriptTarget.ES2022 }, tsModule.version, false, tsModule);
  const system = vfs.createSystem(defaultMap);

  // 空ファイル一覧で仮想環境を作成。後から createFile/updateFile する。
  env = vfs.createVirtualTypeScriptEnvironment(system, [], tsModule, { allowJs: true });

  initialized = true;
  console.log('vfs boot completed. TypeScript version:', tsModule.version);
}

/* -------------------- ヘルパー -------------------- */

function uriToPath(uri) {
  if (!uri) return uri;
  if (uri.startsWith('file:///')) return uri.slice('file:///'.length);
  if (uri.startsWith('file://')) return uri.slice('file://'.length);
  return uri;
}

function offsetToPos(text, offset) {
  const safe = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, safe);
  const lines = before.split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}
function posToOffset(text, pos) {
  const lines = text.split('\n');
  const line = Math.max(0, Math.min(pos.line || 0, lines.length - 1));
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i].length + 1;
  off += Math.max(0, Math.min(pos.character || 0, lines[line].length));
  return off;
}
function displayPartsToString(parts) {
  if (!parts) return '';
  return parts.map(p => p.text).join('');
}

/* -------------------- JSON-RPC メッセージ処理 -------------------- */

async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    await boot(); // 必ず初期化(初回はネットワークで lib を取得する)

    // --- initialize ---
    if (method === 'initialize') {
      const caps = { completionProvider: { resolveProvider: true } };
      sendResponse(id, { capabilities: caps });
      return;
    }

    // --- textDocument/completion ---
    if (method === 'textDocument/completion') {
      const uri = params?.textDocument?.uri;
      const path = uriToPath(uri);
      const content = fileContents.get(path) ?? '';
      const pos = params?.position ?? { line: 0, character: 0 };
      const offset = posToOffset(content, pos);

      try {
        const completions = env.languageService.getCompletionsAtPosition(path, offset, { allowIncompleteCompletions: true });
        let items = [];
        if (completions && completions.entries) {
          items = completions.entries.map(e => ({
            label: e.name,
            kind: e.kind,
            data: { path, offset, name: e.name }
          }));
        }
        sendResponse(id, { isIncomplete: false, items });
      } catch (e) {
        sendError(id, -32000, String(e));
      }
      return;
    }

    // --- completionItem/resolve ---
    if (method === 'completionItem/resolve') {
      const item = params;
      const data = item?.data;
      if (!data) {
        sendResponse(id, item);
        return;
      }
      const { path, offset, name } = data;
      try {
        const details = env.languageService.getCompletionEntryDetails(path, offset, name, undefined, undefined);
        const doc = displayPartsToString(details?.documentation) || '';
        const signature = displayPartsToString(details?.displayParts) || '';
        const insertText = (details && details.insertText) ? details.insertText : name;
        const kind = details?.kind || item.kind;
        const resolved = Object.assign({}, item, { detail: signature, documentation: doc, insertText, kind });
        sendResponse(id, resolved);
      } catch (e) {
        sendError(id, -32000, String(e));
      }
      return;
    }

    // --- textDocument/diagnostics (request) ---
    if (method === 'textDocument/diagnostics' || method === 'workspace/diagnostics') {
      const uri = params?.textDocument?.uri || params?.uri;
      const path = uriToPath(uri);
      const content = fileContents.get(path) ?? '';
      try {
        const synt = env.languageService.getSyntacticDiagnostics(path) || [];
        const sem = env.languageService.getSemanticDiagnostics(path) || [];
        const all = [...synt, ...sem];
        const mapped = all.map(d => {
          const start = d.start ?? 0;
          const len = d.length ?? 0;
          const r1 = offsetToPos(content, start);
          const r2 = offsetToPos(content, start + len);
          const message = (typeof d.messageText === 'string') ? d.messageText : (d.messageText?.message || JSON.stringify(d.messageText));
          return {
            range: { start: r1, end: r2 },
            message,
            severity: (d.category === tsModule.DiagnosticCategory.Error ? 'error' : 'warning'),
            code: d.code
          };
        });
        sendResponse(id, mapped);
      } catch (e) {
        sendError(id, -32000, String(e));
      }
      return;
    }

    // --- その他: ping (デバッグ用) ---
    if (method === 'ping') {
      sendResponse(id, { echoed: params?.msg ?? null });
      return;
    }

    // 未知メソッド
    sendError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    sendError(id ?? null, -32000, String(err));
  }
}

async function handleNotification(msg) {
  const { method, params } = msg;
  await boot();
  // didOpen: 仮想FSに登録
  if (method === 'textDocument/didOpen') {
    const td = params?.textDocument;
    const uri = td?.uri;
    const path = uriToPath(uri);
    const text = td?.text ?? '';
    fileContents.set(path, text);
    try { env.createFile(path, text); }
    catch (e) { try { env.updateFile(path, text); } catch (_) { env.sys.writeFile(path, text); } }
    console.log('[worker] didOpen', uri, `(len=${text.length})`);
    return;
  }

  // didChange (full text)
  if (method === 'textDocument/didChange') {
    const td = params?.textDocument || {};
    const uri = td.uri || params?.uri;
    const path = uriToPath(uri);
    let text = null;
    if (params?.content !== undefined) text = params.content;
    else if (params?.contentChanges && params.contentChanges.length) text = params.contentChanges[0].text;
    else if (params?.text !== undefined) text = params.text;
    if (text !== null) {
      fileContents.set(path, text);
      try { env.updateFile(path, text); } catch (e) { try { env.createFile(path, text); } catch (_) { env.sys.writeFile(path, text); } }
      console.log('[worker] didChange', uri, `(len=${text.length})`);
    }
    return;
  }

  // その他の通知はログに出す
  console.log('[worker] notification', method, params);
}

// --- onmessage 受信エントリポイント ---
// main 側は文字列化して送ってくる前提(JSON.stringify(obj))
self.onmessage = (ev) => {
  const raw = ev.data;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch (e) {
      sendError(null, -32700, 'Parse error');
      return;
    }
  }
  if (!obj) return;
  // リクエスト(id がある)か通知(id がない)で分岐
  if (obj.id !== undefined) {
    void handleRequest(obj);
  } else {
    void handleNotification(obj);
  }
};
