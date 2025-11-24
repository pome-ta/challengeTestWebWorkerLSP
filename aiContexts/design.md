design.md

プロジェクト設計ドキュメント (v0.0.0.0 → 現在までの流れを含む)

このファイルは root/aiContexts/design.md に配置する前提で作成されている。
以下は、本プロジェクトの 歴史・背景・設計方針・構成 をまとめたもの。

⸻

1. バージョン履歴と開発の流れ

本プロジェクトは v0.0.0.0 を起点とし、テスト状態もバージョン管理対象とする方針で進めている。
実装の流れは以下の段階で進行した。

v0.0.0.0
	•	LSP を Web Worker 上で動作させる最小構成を検証。
	•	TypeScript 仮想ファイルシステム（@typescript/vfs）をどう利用するかの調査段階。
	•	コードは散発的に存在しており、統一的な設計思想は未整備。

v0.0.0.1
	•	Worker 側に LspServerCore (仮) を導入。
	•	initialize / initialized / shutdown の LSP ライフサイクルを理解しはじめた段階。
	•	Web Worker の postMessage("__ready") タイミングと、VFS+TS セットアップの競合（レースコンディション）を初めて問題として認識。

v0.0.0.2 〜 v0.0.0.x
	•	WorkerClient を整理し、main thread と worker thread の RPC 構造を固めた。
	•	send() と notify() を区別し、JSON-RPC の形を整備。
	•	CodeMirror + codemirror/lsp-client を今後統合する前提で、最小限の LSP メソッドだけを実装。
	•	initialize
	•	initialized
	•	shutdown
	•	ping

v0.0.1.x（設計整理フェーズ）
	•	設計が複雑化してきたため
	•	design.md（設計方針の集約）
	•	coding-style.md（書き方の標準化）
をプロジェクト直下に置く方針にした。
	•	ChatGPT と安定して会話するための「設計ファイル運用ルール」も追加。
	•	のちに、これらのファイルは root/aiContexts/ に移動する方針へ変更された。

v0.0.2.0〜
	•	Worker 構造の最終整理を開始。
	•	LSP 実装を CodeMirror に接続する準備を進めている段階。
	•	worker 同期 (__ready vs initialize) 問題の再調整。
	•	VFS コアの役割（core/vfs-core.js）の再定義が進行。

⸻

2. ディレクトリ構成（現在の決定版）

プロジェクトの全体構造は以下のように整理されている。

root/
    aiContexts/
        design.md        ← 本ファイル
        coding-style.md

    docs/
        js/
            core/
                lsp-core.js
                vfs-core.js
            test/
            util/
            worker.js

ポイント:
	•	設計とルールは root/aiContexts/ に集約して管理する。
	•	実装は docs/js/ 配下に置く。
	•	ChatGPT や Gemini Code Assist などに読み込ませやすい構造を優先している。

⸻

3. 設計思想（Principles）

3.1 基本方針
	•	最小実装・最少コード … 不要な抽象化を避ける。
	•	標準 LSP 準拠 … 独自拡張を避け、codemirror/lsp-client との互換性を最大化。
	•	Worker を第一級エンジンにする … main thread は UI のみ担当。
	•	ファイルシステムは VFS（TypeScript vfs）に一本化 … 独自管理はしない。

3.2 変更しないルール
	•	Worker では必ず self.postMessage() を明記。
	•	JS の例は DOM ベースで示す（Node.js 例は極力避ける）。
	•	文字列はテンプレートリテラルを使う（+ 結合禁止）。
	•	コメントは「変更部分だけ」に付ける。

⸻

4. LSP 実装構成（詳細）

4.1 main thread
	•	WorkerClient を介して Worker と通信。
	•	以下の順で LSP を起動:
	1.	rpc.initialize()（await）
	2.	rpc.initialized()（notify）
	3.	shutdown 時は rpc.shutdown()（await）
	•	今後 CodeMirror との接続に使う。

4.2 worker side

Worker 側は 2 層構造:

LspServerCore
	•	initialize
	•	initialized
	•	ping
	•	shutdown
	•	TS + VFS を内部で管理（ロード、ファイル更新、診断など）。

LSPWorker
	•	JSON-RPC イベントループを担当。
	•	リクエスト（id あり）と通知（id なし）を分離して処理。
	•	未定義メソッドには JSON-RPC エラーを返す。

⸻

5. VFS（core/vfs-core.js）の現在の役割

vfs-core.js は以下を担当:
	•	メモリ上の仮想ファイル管理
	•	TypeScript サービスに渡すためのファイルセット生成
	•	将来的には CodeMirror からの編集イベントをここに集約
	•	Worker 初期化時に TS をロードする前提のため、__ready タイミングに深く関わる

現状、このモジュールと worker 起動時の同期問題が開発の主要テーマ。

⸻

6. 今後の設計意図
	•	CodeMirror からの編集を VFS に正しく反映させる仕組みを作る。
	•	CodeMirror/lsp-client との正式接続。
	•	LSP の診断・補完が正しく動くまでを最優先とする。
	•	worker-client.js と worker-rpc.js の分離はロジックが増えたタイミングで行う。

⸻

以上が、v0.0.0.0 から現在までの開発経緯を含めた最新の設計概要となる。