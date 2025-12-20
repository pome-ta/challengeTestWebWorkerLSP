design.md

プロジェクト設計ドキュメント (v0.0.0.0 → v0.0.3.x Phase 8)

このファイルは root/agentContexts/design.md に配置する前提で作成されている。
以下は、本プロジェクトの 歴史・背景・設計方針・構成 をまとめたもの。

⸻

1. バージョン履歴と開発の流れ

本プロジェクトは v0.0.0.0 を起点とし、テスト状態もバージョン管理対象とする方針で進めている。
**運用ルール**: プロジェクトの進化過程を時系列で把握できるよう、過去のバージョン履歴は削除せず、新たな進捗を追記する形式を維持する。
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
	•	のちに、これらのファイルは root/agentContexts/ に移動する方針へ変更された。

v0.0.2.0〜
	•	Worker 構造の最終整理を開始。
	•	LSP 実装を CodeMirror に接続する準備を進めている段階。
	•	worker 同期 (__ready vs initialize) 問題の再調整。
	•	VFS コアの役割（core/vfs-core.js）の再定義が進行。
	•	テスト環境の整備（test-runner.js, test-utils.js）。

v0.0.3.x（現在：アーキテクチャ刷新と段階的実装）
	初期化プロセスと責務境界を厳密に再定義し、Phase 1〜8 に分けて実装を進めた。
	各フェーズの詳細な仕様とテスト観点は、後述の「4. v0.0.3 実装フェーズ詳細」に集約している。

	•	**初期化の分離**: `worker/ready` (Transport), `vfs/ensureReady` (Environment), `lsp/initialize` (Protocol) の3段階に分離。
	•	**Phase 3 (Visibility)**: `vfs/openFile` が LSP に認識されるための最小条件を定義。
	•	**Phase 4 (Snapshot)**: VFS を Document State（content + version）の唯一の正（Source of Truth）と定義。
	•	**Phase 5 (Event-Driven)**: `initialize` 時のまとめ処理を廃止し、`openFile` / `updateFile` が `didOpen` / `didChange` を発火させるイベント駆動モデルへ移行。
	•	**Phase 6 (Lifecycle)**: `didClose` および Multi-file（複数 URI 独立管理）の対応。
	•	**Phase 7 (Incremental)**: Incremental Sync と Diagnostics（診断）通知のパイプライン確立。
	•	**Phase 8 (Features)**: `completion` / `hover` の実体化（TypeScript LS への接続）。

⸻

2. ディレクトリ構成（現在の決定版）

プロジェクトの全体構造は以下のように整理されている。

root/
    agentContexts/
        design.md        ← 本ファイル
        coding-style.md
        canvas/
            v0.0.3/      ← 各フェーズの詳細仕様書（spec-first）

    docs/
        js/
            core/
                lsp-core.js
                vfs-core.js
            test/
                test-runner.js
                v0.0.3/      ← テストユーティリティも更新
                    test-utils.js
            util/
                logger.js
            worker.js

ポイント:
	•	設計とルールは root/agentContexts/ に集約して管理する。
	•	実装は docs/js/ 配下に置く。
	•	ChatGPT や Gemini Code Assist などに読み込ませやすい構造を優先している。
	•	詳細な仕様決定プロセスは `agentContexts/canvas/v0.0.3/` 内の各フェーズドキュメントを参照。

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

3.3 v0.0.3 での追加原則
	•	**Spec-first**: 実装前に「観測可能な事実」としてのテスト仕様（debug RPC 含む）を確定させる。
	•	**Single Responsibility**: Transport (Worker), VFS, LSP の責務を混同させない。
	•	**VFS as Source of Truth**: ドキュメントの内容とバージョン管理は VFS が行い、LSP はその通知を受け取るだけのステートレスな存在とする。
	•	**Event-driven Sync**: 初期化時に全ファイルを同期するのではなく、操作（open/update/close）に応じたイベント発火で同期する。

⸻

4. v0.0.3 実装フェーズ詳細（Spec-first）

v0.0.3 では「Spec-first（テスト仕様先行）」を徹底し、以下のフェーズごとに仕様を確定・実装した。
各フェーズは「目的」「仕様」「テスト観点」で定義される。

4.1 初期化プロセスの分離 (Phase 1-2)
	•	**目的**: Worker 起動、VFS 準備、LSP 初期化の責務を分離し、競合状態を解消する。
	•	**仕様**:
		1.	`worker/ready`: Transport 層の確立（RPC 受付開始）。即時通知。
		2.	`vfs/ensureReady`: Environment 層の確立（CDN fetch, TS setup）。明示的リクエスト。
		3.	`lsp/initialize`: Protocol 層の確立。`ensureReady` 完了が前提。
	•	**テスト観点**: 各段階が順序通りに完了し、前提満たさぬ呼び出しがエラーになること。

4.2 Phase 3: LSP Visibility (存在検知)
	•	**目的**: `vfs/openFile` されたファイルが、いつ LSP から「見える」ようになるかを定義。
	•	**仕様**:
		•	`vfs/openFile` は VFS ready なら成功するが、LSP initialize 前は不可視。
		•	LSP initialize 後に初めて Language Service の対象となる。
	•	**テスト観点**: `textDocument/hover` が `-32601` (Method not found) ではなく、正常（または空）応答を返すこと。

4.3 Phase 4: Document Snapshot & Sync
	•	**目的**: ドキュメントの状態管理（Source of Truth）を VFS に一本化する。
	•	**仕様**:
		•	**Snapshot**: `uri`, `content`, `version` の組。VFS が管理。
		•	**Versioning**: ファイル更新ごとに単調増加。初回 open 時は `1`。
		•	**Sync**: VFS の操作に応じて `textDocument/didOpen` 等を発行。
	•	**テスト観点**: debug RPC (`getLastDidOpen`) を用い、version 1 で同期される事実を観測。

4.4 Phase 5: Event-Driven Sync
	•	**目的**: Initialize 時に全ファイルを同期する「まとめ処理」を廃止し、イベント駆動へ移行。
	•	**仕様**:
		•	Initialize 前の操作は State 蓄積のみ。
		•	Initialize 後の `openFile` は即座に `didOpen` (または `didChange`) を発火。
		•	`updateFile` は `didChange` を発火。
	•	**テスト観点**: Initialize 前後の操作によるイベント発火有無の差異。

4.5 Phase 6: Lifecycle (Close & Multi-file)
	•	**目的**: ドキュメントの破棄と、複数ファイルの独立管理。
	•	**仕様**:
		•	`vfs/closeFile`: 内部 State を破棄し `textDocument/didClose` を発火。
		•	**Isolation**: File A の操作・バージョンは File B に影響しない。
		•	再 Open 時は version 1 からリセット。
	•	**テスト観点**: `didClose` の発火確認。Close 後の update が無視されること。

4.6 Phase 7: Incremental Sync & Diagnostics
	•	**目的**: 実用的な編集同期と診断通知のパイプライン確立。
	•	**仕様**:
		•	**Incremental**: `didChange` は差分（range + text）で通知。VFS 側でテキスト再構築。
		•	**Diagnostics**: `didOpen` / `didChange` 後に診断（Phase 7 時点は空配列）を通知。
	•	**テスト観点**: 差分適用後のテキストが正しいか。Diagnostics が適切なタイミングで発火するか。

4.7 Phase 8: Features (Completion / Hover)
	•	**目的**: TypeScript Language Service への接続と機能実体化。
	•	**仕様**:
		•	`textDocument/completion`: TS LS から補完候補を取得（Phase 8 は空配列でOK）。
		•	`textDocument/hover`: TS LS から情報を取得（Phase 8 は空文字でOK）。
		•	エラーではなく正規の LSP レスポンスを返す経路を確立。
	•	**テスト観点**: `completion` / `hover` がエラーにならずに応答すること。

⸻

5. LSP 実装構成（詳細）

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

5.1 v0.0.3 初期化フロー（3段階）

v0.0.3 で確立された厳密な初期化シーケンス：

1.  **Worker 起動**
    *   `worker/ready` 通知（即時）。JSON-RPC の受付開始のみを意味する。
2.  **VFS 準備**
    *   `vfs/ensureReady` リクエスト。CDN からの TS ライブラリ取得、仮想環境構築。
3.  **LSP 初期化**
    *   `lsp/initialize` リクエスト。Protocol レベルの初期化。

5.2 v0.0.3 同期モデル（Event-driven）

*   **vfs/openFile**:
    *   Initialize 後、初回なら `textDocument/didOpen` を発火。
    *   既に Open 済みなら `textDocument/didChange` を発火（Phase 5 仕様）。
*   **vfs/updateFile**:
    *   `textDocument/didChange` (Incremental) を発火。
    *   Version を +1 する。
*   **vfs/closeFile**:
    *   `textDocument/didClose` を発火。
    *   内部状態を破棄。

⸻

5. VFS（core/vfs-core.js）の現在の役割

vfs-core.js は以下を担当:
	•	メモリ上の仮想ファイル管理
	•	TypeScript サービスに渡すためのファイルセット生成
	•	将来的には CodeMirror からの編集イベントをここに集約
	•	Worker 初期化時に TS をロードする前提のため、__ready タイミングに深く関わる

現状、このモジュールと worker 起動時の同期問題が開発の主要テーマ。

v0.0.3 での再定義:
vfs-core.js は **Document State の唯一の管理者** である。
*   **Document Snapshot**: `uri`, `content`, `version` の組を保持。
*   **Versioning**: ファイル更新のたびに単調増加する整数を管理。
*   **Isolation**: 複数ファイルを URI ごとに独立して管理（Multi-file 対応）。
*   **Environment**: `@typescript/vfs` の System / Env をラップし、LSP Core に提供。

⸻

7. 今後の設計意図
	•	CodeMirror からの編集を VFS に正しく反映させる仕組みを作る。
	•	CodeMirror/lsp-client との正式接続。
	•	LSP の診断・補完が正しく動くまでを最優先とする。
	•	worker-client.js と worker-rpc.js の分離はロジックが増えたタイミングで行う。
	•	**Phase 9以降**:
		•	Completion / Hover の内容拡充（型情報、ドキュメント表示）。
		•	Signature Help の実装。
		•	CodeMirror UI 側での補完候補表示の最適化。

⸻

以上が、v0.0.3.x Phase 8 完了時点での最新設計概要である。