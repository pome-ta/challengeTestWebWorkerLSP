// worker-transport.js v0.5

// - LSP Client と Web Worker の間を仲介する Transport クラス
// - createWorkerTransport(workerUrl) -> Promise<WorkerTransport>

/**
 * Web Workerとの通信を抽象化し、メッセージの送受信を管理するクラス。
 * このクラスはモジュール内部でのみ使用され、直接エクスポートされない。
 *
 * @internal
 * @class WorkerTransport
 * @property {Worker} #worker - Web Workerのインスタンス
 * @property {Map<Function, string>} #handlers - 登録されたメッセージハンドラとフォーマットのマップ
 * @property {boolean} #debug - デバッグモードの有効/無効フラグ
 */
class WorkerTransport {
  #worker;
  #handlers = new Map(); // handler -> format
  #debug;

  /**
   * @param {Worker} worker - 通信対象のWeb Workerインスタンス
   * @param {boolean} [debug=false] - デバッグモードを有効にするか
   */
  constructor(worker, debug = false) {
    this.#worker = worker;
    this.#debug = debug;

    // Workerからのメッセージを受信したときの処理
    this.#worker.onmessage = (event) => {
      const data = event.data;

      this.#handlers.forEach((format, handler) => {
        try {
          // format に応じてメッセージを変換し、ハンドラを呼び出す
          // 'json': 文字列形式のJSONを要求するハンドラ用 (例: LSPClient)
          // 'raw':  オブジェクト形式を要求するハンドラ用 (例: WorkerClientImpl)
          const message =
            format === 'json'
              ? typeof data === 'string'
                ? data
                : JSON.stringify(data)
              : data;
          handler(message);
        } catch (err) {
          console.error('[worker-transport] handler error:', err);
        }
      });
    };

    // Workerからのメッセージでデシリアライズ不可能なものが送られた場合のエラーハンドリング
    this.#worker.onmessageerror = (err) => {
      console.error('[worker-transport] message error:', err);
    };

    // Worker内部で発生した未キャッチのエラーのハンドリング
    this.#worker.onerror = (err) => {
      console.error('[worker-transport] worker error:', err);
    };
  }

  /**
   * Workerにメッセージを送信する。
   * @param {string | object} message - 送信するメッセージ。
   */
  send(message) {
    // LSPClient が送るような JSON 文字列の場合、パースしてオブジェクトとして送信する
    // ことで、Worker 側は常に効率的な構造化クローンを利用できる。
    if (typeof message === 'string') {
      try {
        const obj = JSON.parse(message);
        this.#worker.postMessage(obj);
        if (this.#debug)
          console.debug('[worker-transport] sent (parsed object):', obj);
        return;
      } catch {
        // JSONではない文字列の場合はそのまま送信
      }
    }

    // オブジェクトはそのまま送信
    try {
      this.#worker.postMessage(message);
      if (this.#debug) {
        console.debug('[worker-transport] sent:', message);
      }
    } catch (e) {
      console.error('[worker-transport] postMessage failed:', e, message);
    }
  }

  /**
   * Workerからのメッセージを受信するためのハンドラを登録する。
   * @param {Function} handler - メッセージを受信したときに呼び出されるコールバック関数。
   * @param {object} [options={}] - オプション。
   * @param {'json' | 'raw'} [options.format='json'] - ハンドラに渡すメッセージの形式。'json'は文字列、'raw'はオブジェクト。
   */
  subscribe(handler, options = {}) {
    const { format = 'json' } = options; // デフォルトは 'json'
    this.#handlers.set(handler, format);

    this.#debug &&
      console.debug('[worker-transport] handler subscribed:', {
        handler,
        format,
      });
  }

  /**
   * 登録済みのメッセージハンドラを解除する。
   * @param {Function} handler - 解除するハンドラ。
   */
  unsubscribe(handler) {
    if (this.#handlers.has(handler)) {
      this.#handlers.delete(handler);
      this.#debug &&
        console.debug('[worker-transport] handler unsubscribed:', handler);
    }
  }

  /**
   * Workerを終了させる。
   * これ以降、このインスタンスは使用できなくなる。
   */
  close() {
    this.#worker.terminate();
    this.#debug && console.debug('[worker-transport] worker terminated');
  }

  /**
   * 内部で保持しているWorkerインスタンスを返す。
   * @returns {Worker}
   */
  get worker() {
    return this.#worker;
  }
}

/**
 * `@codemirror/lsp-client` の `LSPClient` が要求するインターフェースに適合させるためのアダプタクラス。
 * 主な役割は、`subscribe` メソッドのデフォルトフォーマットを 'json' に固定すること。
 *
 * @export
 * @class LSPTransportAdapter
 */
export class LSPTransportAdapter {
  #transport;
  /**
   * @param {WorkerTransport} transport - ラップするWorkerTransportインスタンス。
   */
  constructor(transport) {
    this.#transport = transport;
  }
  send = (message) => this.#transport.send(message);
  /**
   * LSPClient用に、常に 'json' 形式でハンドラを登録する。
   * @param {Function} handler
   */
  subscribe = (handler) =>
    this.#transport.subscribe(handler, { format: 'json' });
  unsubscribe = (handler) => this.#transport.unsubscribe(handler);
  close = () => this.#transport.close();
  get worker() {
    return this.#transport.worker;
  }
}

/**
 * WorkerTransportのインスタンスを非同期で生成するファクトリ関数。
 * @export
 * @param {string} workerUrl - Web WorkerのスクリプトURL。
 * @param {boolean} [debug=false] - デバッグモードを有効にするか。
 * @returns {Promise<WorkerTransport>} WorkerTransportのインスタンスを解決するPromise。
 */
export async function createWorkerTransport(workerUrl, debug = false) {
  const worker = new Worker(workerUrl, { type: 'module' });
  return new WorkerTransport(worker, debug);
}
