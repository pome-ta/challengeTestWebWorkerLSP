# v0.0.3 における ready / ensureReady / initialize の役割定義

## 目的

v0.0.3 系では、Web Worker 上で LSP を成立させるための **初期化フェーズを段階的に分離**する。 これにより、

- 初期化順序の明確化
- 失敗点の特定容易性
- 将来拡張（ATA, multi-root, warm restart）への耐性

を確保する。

---

## 初期化フェーズ全体像

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

## worker/ready

### 役割

- Worker が起動し、**JSON-RPC メッセージを受信・処理可能**になったことを通知する
- 通信レイヤの準備完了のみを意味する

### 保証しないこと

- VFS が初期化されていること
- TypeScript Service / env が生成済みであること
- LSP が初期化済みであること

### 設計意図

- Worker lifecycle と VFS / LSP lifecycle を分離する
- Worker 起動を極力軽量に保つ
- 失敗し得る処理を Worker 起動フェーズから排除する

---

## vfs/ensureReady

### 役割

- VFS が **利用可能な状態にあることを保証**する
- 必要に応じて内部初期化を実行する

### 含まれる処理（代表例）

- CDN からの TypeScript / lib.d.ts 取得
- @typescript/vfs の env 構築
- 依存リソースのロード

### 特徴

- JSON-RPC request として呼び出される
- retry / timeout / error を明示的に扱える
- 再実行可能であることを前提とする

### 設計意図

- 重い処理・失敗し得る処理を RPC 管理下に置く
- 初期化失敗を main 側で確実に検知可能にする

---

## lsp/initialize

### 役割

- LSP としての初期化を完了させる
- client capability を受け取り、サーバー状態を確定する

### 前提条件

- worker/ready が完了していること
- vfs/ensureReady が完了していること

### 設計意図

- LSP プロトコルの定義に忠実に従う
- VFS / TS の準備状態と LSP 初期化を混同しない

---

## 設計上の固定事項（v0.0.3）

- `worker/ready` は **RPC 受付開始のみ**を意味する
- `vfs/ensureReady` が VFS 利用可否の唯一の保証点
- `lsp/initialize` は VFS 完了後にのみ呼び出す
- 初期化順序を逆転させない

---

## 将来拡張に向けた余地

- vfs/ensureReady 内部の実装は将来拡張可能
  - ATA 導入
  - パッケージ解決
  - キャッシュ戦略
- ready の意味は v0.0.x 系で固定する

---

この設計により、v0.0.3 系では「小さく・確実に」LSP 基盤を構築することを最優先とする。

