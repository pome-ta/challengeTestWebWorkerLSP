// worker.js v0.9
/**
 * @file Web Workerのエントリーポイント。
 * LSPWorkerをインスタンス化して、メッセージの待受を開始する。
 */

import { LSPWorker } from './lsp-worker.js';

// Workerのインスタンスを作成し、メッセージの待受を開始する
new LSPWorker();
