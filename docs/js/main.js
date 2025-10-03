// main.js
// - Worker (worker.js) を module Worker として起動
// - JSON-RPC 風の文字列メッセージを send / recv する rpcRequest / notify を用意
// - ボタンで一括テスト(initialize -> didOpen -> diagnostics -> completion)を実行

const logEl = document.getElementById('log');
function log(...args) {
  console.log(...args);
  if (logEl) {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logEl.textContent += `[${new Date().toLocaleTimeString()}] ${s}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

// Worker を起動(module Worker)
const worker = new Worker('./js/worker.js', { type: 'module' });
worker.onmessage = (ev) => {
  console.log('[main] got:', ev.data);
};

// boot 要求
worker.postMessage('boot');
// JSON-RPC クライアント実装(シンプル)
let nextId = 1;
const pending = new Map(); // id -> {resolve, reject}

worker.addEventListener('message', (ev) => {
  // Worker は JSON.stringify() で文字列を送ってくる実装を想定
  const raw = ev.data;
  let msg;
  try { msg = (typeof raw === 'string') ? JSON.parse(raw) : raw; }
  catch (e) { log('failed parse message from worker', raw); return; }

  // Worker ログ転送(method: "log")を優先して扱う
  if (msg?.method === 'log' && msg?.params !== undefined) {
    log('[worker a]', msg.params);
    return;
  }

  // JSON-RPC 応答(id がある)を処理
  if (msg?.id !== undefined) {
    const entry = pending.get(msg.id);
    if (!entry) {
      log('orphan response (no pending):', msg);
      return;
    }
    pending.delete(msg.id);
    if (msg.error) entry.reject(msg.error);
    else entry.resolve(msg.result);
    return;
  }

  // 通知(id がないが method がある)を受け取る場合
  if (msg?.method) {
    log('[worker notify]', msg.method, msg.params);
    return;
  }

  // 予期しないメッセージ
  log('[worker other]', msg);
});

function rpcRequest(method, params = {}) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(JSON.stringify(payload));
    // タイムアウト等は必要なら追加可能
  });
}

function notify(method, params = {}) {
  const payload = { jsonrpc: '2.0', method, params };
  worker.postMessage(JSON.stringify(payload));
}

/* helper: text -> (line, character) for an offset */
function offsetToLineChar(text, offset) {
  const safe = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, safe);
  const lines = before.split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

/* テスト用の一連の流れ(initialize -> didOpen -> diagnostics -> completion) */
async function runDemo() {
  log('demo: start');
  try {
    // 1) initialize
    const initRes = await rpcRequest('initialize', { processId: null, rootUri: 'file:///', capabilities: {} });
    log('initialize result:', initRes);

    // 2) notify initialized
    notify('initialized', {});
    log('sent: initialized');

    // 3) didOpen: テストファイルを送る(console. がある行を含める)
    const uri = 'file:///main.ts';
    const text = [
      '// TypeScript VFS Worker demo',
      'const a = 123;',
      'console.' // 補完を試すために console. を入れておく
    ].join('\n');
    notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescript', version: 1, text } });
    log('sent: didOpen', uri);

    // 4) diagnostics を要求(Worker が syntactic/semantic を返す)
    const diags = await rpcRequest('textDocument/diagnostics', { textDocument: { uri } });
    log('diagnostics:', diags);

    // 5) completion を要求(console. の直後の位置)
    // offset を計算して line/character に変換
    const consoleOffset = text.indexOf('console.') + 'console.'.length;
    const pos = offsetToLineChar(text, consoleOffset);
    const comp = await rpcRequest('textDocument/completion', { textDocument: { uri }, position: pos });
    log('completion result (raw):', comp);

    // 6) completionItem/resolve を試しに 1 個解決(あれば)
    const items = comp?.items ?? (Array.isArray(comp) ? comp : []);
    if (items && items.length > 0) {
      const first = items[0];
      const resolved = await rpcRequest('completionItem/resolve', first);
      log('resolved first completion:', resolved);
    } else {
      log('no completion items returned');
    }

    log('demo: done');
  } catch (e) {
    log('demo error:', e);
  }
}

// ボタンに紐づけ
document.getElementById('btn-init').addEventListener('click', runDemo);

// (自動実行したければ次の行のコメントを外す)
//runDemo();
