// --- lsp-worker.js v0.9

import {LspServerCore} from './lsp-server-core.js';

/**
 * メインスレッドにメッセージを送信する。
 * @param {object} obj - メインスレッドに送信するオブジェクト。
 */
function _send(obj) {
  try {
    self.postMessage(obj);
  } catch (e) {
    console.error('[worker | lsp-worker] _send failed to postMessage', e, obj);
  }
}

const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
};

/**
 * JSON-RPCのメッセージを解釈し、適切なLspServerCoreのメソッドにディスパッチするクラス。
 * Workerのエントリーポイントとして機能する。
 * @export
 * @class LSPWorker
 */
export class LSPWorker {
  /** @type {LspServerCore} - LSPコアロジックのインスタンス */
  #core = new LspServerCore();
  /** @type {Object<string, Function>} - RPCメソッドハンドラのマップ */
  #handlers = {};

  constructor() {
    // LspServerCore の公開メソッドを動的にハンドラとして登録する
    for (const name of Object.getOwnPropertyNames(
      Object.getPrototypeOf(this.#core)
    )) {
      const fn = this.#core[name];
      // LSPのRPCメソッド(例: 'textDocument/completion')や、
      // カスタムメソッド(例: 'initialize')のみをハンドラとして登録する
      if (
        typeof fn === 'function' &&
        !name.startsWith('#') &&
        name !== 'constructor'
      ) {
        this.#handlers[name] = fn.bind(this.#core);
      }
    }
    // Workerのメッセージハンドラを設定
    self.onmessage = (event) => this.#onMessage(event);
  }

  /**
   * Workerがメッセージを受信したときに呼び出されるメインのハンドラ。
   * JSON-RPCメッセージを解析し、処理をディスパッチする。
   * @param {MessageEvent} event - onmessageイベントオブジェクト。
   */
  async #onMessage(event) {
    const rawData = event.data;
    let msg;

    try {
      // メッセージが文字列ならJSONとしてパース、オブジェクトならそのまま使用
      msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (e) {
      this.#sendErrorResponse(null, RpcErrorCode.ParseError, 'Parse error');
      return;
    }

    const {id, method, params, jsonrpc} = msg ?? {};

    // 2. リクエスト検証: JSON-RPC 2.0仕様に準拠しているか、methodが文字列か
    if (jsonrpc !== '2.0' || typeof method !== 'string') {
      // idがあれば、無効なリクエストであることをクライアントに通知
      if (id !== undefined) {
        this.#sendErrorResponse(
          id,
          RpcErrorCode.InvalidRequest,
          'Invalid Request'
        );
      }
      return;
    }

    // 3. ハンドラの検索
    const handler = this.#handlers[method];
    if (typeof handler !== 'function') {
      // idがあれば、メソッドが見つからないことをクライアントに通知
      if (id !== undefined) {
        this.#sendErrorResponse(
          id,
          RpcErrorCode.MethodNotFound,
          `Method not found: ${method}`
        );
      }
      return;
    }

    // 4. ハンドラ実行と結果の返却
    try {
      const result = await handler(params, msg); // ハンドラを実行
      // idがあればリクエストなので、結果をレスポンスとして返す
      if (id !== undefined) {
        _send({jsonrpc: '2.0', id, result});
      }
    } catch (e) {
      // ハンドラ実行中にエラーが発生した場合
      // サーバー内部のエラー -> Internal Error
      if (id !== undefined) {
        this.#sendErrorResponse(
          id,
          RpcErrorCode.InternalError,
          e?.message ?? String(e),
          {stack: e?.stack}
        );
      }
    }
  }

  /**
   * JSON-RPCのエラーレスポンスを送信するヘルパーメソッド。
   * @param {string | number | null} id - 対応するリクエストのID。
   * @param {number} code - エラーコード。
   * @param {string} message - エラーメッセージ。
   * @param {any} [data] - エラーに関する追加情報。
   */
  #sendErrorResponse(id, code, message, data) {
    const error = {code, message};
    if (data) error.data = data;
    _send({jsonrpc: '2.0', id, error});
  }
}
