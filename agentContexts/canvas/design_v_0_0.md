# v0.0.3 Ready / EnsureReady / Initialize 設計定義

## 目的

v0.0.3 系では、WebWorker + JSON-RPC + @typescript/vfs を用いた LSP 実装において、**初期化フェーズの責務と境界を明確化**する。

特に以下の3点を厳密に分離する。

- Worker の起動と RPC 受付開始
- VFS（TypeScript 仮想 FS）の利用可能状態
- LSP プロトコル上の初期化完了

この分離により、非同期初期化・CDN 依存・将来拡張に対して安定した基盤を確保する。

---

## 用語とフェーズ定義

### 1. `worker/ready`

**意味**

- WebWorker がロードされた
- `message` イベントリスナが登録された
- JSON-RPC メッセージを受信・処理できる状態になった

**含まれないもの**

- VFS の初期化完了
- TypeScript 環境（env）の生成
- LSP の初期化

**位置づけ**

- Transport レイヤの ready
- LSP 仕様における「通信路確立」に相当

**設計上の不変条件**

- `worker/ready` は常に **即時送信**される
- ネットワーク（CDN）や VFS 初期化の成否に依存しない
- 将来バージョンでも意味は変更しない

---

### 2. `vfs/ensureReady`

**意味**

- `@typescript/vfs` の defaultMap が取得済み
- 仮想ファイルシステムが構築可能
- TypeScript Virtual Environment が生成済み
- VFS API を安全に呼び出せる状態

**責務**

- CDN fetch を含む非同期初期化を担当
- retry / timeout などの実行時安定性を VFS 層に閉じ込める

**設計上の性質**

- 明示的に呼ばれる
- 冪等（複数回呼んでも安全）
- 完了しない限り VFS 依存 API は使用不可

**位置づけ**

- Server internal ready
- LSP 初期化より前段にある基盤準備フェーズ

---

### 3. `lsp/initialize`

**意味**

- LSP プロトコル上の initialize リクエスト処理
- capability 交渉
- compilerOptions の確定

**前提条件**

- `vfs/ensureReady` が完了していること

**責務**

- LSP 状態管理の開始
- ドキュメント同期（didOpen/didChange）を受け付ける準備

**位置づけ**

- LSP protocol ready
- クライアントとサーバの論理的接続確立

---

## フェーズ間の関係

```
Worker 起動
   ↓
worker/ready            (RPC 受付開始)
   ↓
vfs/ensureReady         (VFS 利用可能)
   ↓
lsp/initialize          (LSP 初期化完了)
   ↓
textDocument/*          (通常運用)
```

---

## 設計ポリシー（v0.0.3）

- 各フェーズは**単一責務**とする
- ready の意味を跨がせない
- 上位フェーズは下位フェーズに暗黙依存しない
- 非同期・失敗し得る処理は VFS 層に閉じ込める

---

## 将来拡張への影響

- ATA 導入
- multi-file VFS
- defaultMap 差し替え
- Worker 再初期化

これらを追加しても、

- `worker/ready` の意味は不変
- `vfs/ensureReady` に処理を追加するだけ
- LSP 初期化フローは維持

という形で拡張可能とする。

---

## まとめ（v0.0.3 の確定事項）

- `worker/ready` = RPC 受付開始
- `vfs/ensureReady` = VFS 初期化完了
- `lsp/initialize` = LSP プロトコル初期化

この三段階を **明確に分離したまま実装を進める**。

