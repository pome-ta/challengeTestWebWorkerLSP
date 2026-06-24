// worker.js
import { createContainer } from 'https://esm.sh/almostnode';

console.log('[Worker] スクリプトが読み込まれました！');

async function init() {
  console.log('[Worker] createContainerを開始します...');
  const container = await createContainer();
  console.log('[Worker] createContainerが完了しました！');

  container.vfs.writeFileSync('/main.ts', "console.log('Hello LSP!');");

  console.log('[Worker] typescript-language-server をインストール中...');
  await container.npm.install('typescript-language-server');
  console.log('[Worker] typescript をインストール中...');
  await container.npm.install('typescript');
  console.log('[Worker] npm install が完了しました！');

  // ==========================================
  // 3. 魔のヘッダー処理ロジック（改良版）
  // ==========================================
  let buffer = '';
  let pendingContentLength = -1;

  // 【A】 LSPサーバー ➔ メインスレッド
  container.on('stdout', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    console.log('[Worker] ⬅️ LSPから受信 (生データ):', text); // ★何が返ってきたか覗き見！
    buffer += text;

    while (true) {
      if (pendingContentLength === -1) {
        const match = buffer.match(/Content-Length: (\d+)\r\n\r\n/i);
        if (!match) break;

        pendingContentLength = parseInt(match[1], 10);
        buffer = buffer.substring(match[0].length);
      }

      if (buffer.length >= pendingContentLength) {
        const jsonMessage = buffer.substring(0, pendingContentLength);
        console.log('[Worker] ⬅️ パース成功 (JSON):', jsonMessage); // ★パース後の姿
        self.postMessage(jsonMessage);

        buffer = buffer.substring(pendingContentLength);
        pendingContentLength = -1;
      } else {
        break;
      }
    }
  });

  // エラー出力用
  container.on('stderr', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    console.error('[LSP Error]', text);
  });

  // 【B】 メインスレッド ➔ LSPサーバー
  self.onmessage = (event) => {
    // ★ 修正箇所: オブジェクトで届いた場合は、JSON文字列に変換する！
    const jsonString = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);

    // 正しいバイト数を計算してヘッダーを付ける
    const messageWithHeader = `Content-Length: ${new Blob([jsonString]).size}\r\n\r\n${jsonString}`;

    console.log('[Worker] ➔ LSPへ送信:', messageWithHeader); // ★何を送信したか覗き見！
    container.sendInput(messageWithHeader);
  };

  // 4. プロセスの起動
  console.log('[Worker] typescript-language-server を起動します...');
  // ★修正箇所: 環境パスに依存せず、確実なパスを node で直接叩く
  container.run('node', ['./node_modules/typescript-language-server/lib/cli.mjs', '--stdio']);

  // 5. パイプが繋がったことをメインスレッドに知らせる
  console.log('[Worker] メインスレッドに __ready を送信します！');
  self.postMessage({ type: '__ready' });
}

init();
