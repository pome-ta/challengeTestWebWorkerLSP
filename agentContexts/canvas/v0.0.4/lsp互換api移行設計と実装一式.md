# LSP互換API設計（全面再設計・確定版）

## 目的

- JSON-RPC ベース
- Language Server Protocol 互換
- `vfs/*` 独自 API を排除
- `textDocument/*` と `workspace/*` に統合
- TypeScript Compiler API ベース

## 採用する API セット

### 初期化フェーズ

- `initialize` (request)
- `initialized` (notification)
- `shutdown` (request)
- `exit` (notification)

### ドキュメント管理

- `textDocument/didOpen`
- `textDocument/didChange`
- `textDocument/didClose`

### 言語機能

- `textDocument/completion`
- `textDocument/hover`

## 重要設計方針

- **VFS という名前の API は廃止**
- 代替はすべて `textDocument/*`
- `initialize()` が **ensureReady() を内部実行**
- 利用者側で `ensureReady` を呼ぶ必要なし
- TextDocumentManager は **シングルトン**

---

# 実装構成

- core/vfs-core.js
- core/text-document-manager.js
- core/lsp-server-core.js
- worker.js

---

## core/vfs-core.js

- TypeScript 仮想ファイルシステム
- @typescript/vfs を利用
- シングルトン

## core/text-document-manager.js

- LSP TextDocument 管理互換
- open/change/close
- CompilerHost と同期

## core/lsp-server-core.js

- initialize / shutdown 管理
- Language features

---

# 完全コード一覧

以下に本設計へ完全整合するコードを提示する。

この設計を基準に以後の修正・テストを行う。

