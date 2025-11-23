# Design Document (v0.0.2.x)

本プロジェクトは、Web Worker 上で動作する軽量 LSP サーバを構築し、  
CodeMirror LSP クライアントと連携させることを目的とする。

---

## 1. 全体構成

```
root/
    design.md
    coding-style.md
    docs/
        js/
            worker.js
            core/
                vfs-core.js
                lsp-core.js
            util/
                logger.js
            test/
                v0.0.2/
                    test-utils.js
                    worker-vfs-init.test.js
```

### 目的
- **VFS (Virtual File System)** と **LSP ロジック** を完全に分離する。
- **worker.js** は **JSON-RPC dispatcher** としてのみ振る舞わせる（最小責務）。
- レースコンディションを排除し、`__ready` の同期を厳密にする。
- CodeMirror LSP クライアントとの接続を前提として、不要な独自仕様を排除する。

---

## 2. Worker Architecture

### worker.js の責務
- JSON-RPC メッセージループ（`message` event → dispatch）
- `method` に従って `lsp-core` または `vfs-core` に処理を委譲
- 明確な `request` / `response` / `notification` の区別
- ログはすべて `postLog()` 経由でメインスレッドへ

---

## 3. Core Modules

### 3.1 VfsCore

**役割**
- TypeScript VFS の初期化
- `createDefaultMapFromCDN()` のリトライ
- LSP に必要な最小限のファイル操作を提供

**要求仕様**
- worker 起動時に `ensureReady()` を明示的に呼ぶ
- 初期化成功で `__vfs-ready`
- 失敗時は JSON-RPC error を送出

---

### 3.2 LspCore

**役割**
- LSP lifecycle (`initialize`, `initialized`, `shutdown`, `ping`)
- 仮想ファイルの解析（semantic/diagnostic 取得など）
- 将来、CodeMirror LSP 依存の API に拡張

**注意事項**
- CodeMirror の仕様に寄せ、最小限の LSP 必要機能のみを扱う
- v0.0.1.x の実装は参照しない（再構成済み）

---

## 4. JSON-RPC Design

### Request
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "vfs/ensureReady",
  "params": {}
}
```

### Response
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

### Notification
```json
{
  "jsonrpc": "2.0",
  "method": "lsp/initialized",
  "params": {}
}
```

---

## 5. Logging

すべてのログは以下ルールに従う。

```
[HH:MM:SS.mmm | WorkerLog] message
```

- 出力関数は `postLog()` のみ
- Worker 側では `self.postMessage()` を必ず明示する

---

## 6. Testing Strategy (TDD)

### テスト構造
```
docs/js/test/v0.0.2/
    test-utils.js
    worker-vfs-init.test.js
```

### 基本方針
- **テストが仕様を先に定義する**（TDD）
- 各テストには次を記述
  - Expected Behavior（仕様）
  - Expected Output（実際の値）
- v0.0.1.x のテスト移植は行わない。すべて再設計。

---

## 7. 取り決めの保持内容

- `self.postMessage()` を worker 内で必ず使用
- モジュール構成は `js/core`, `js/util`, `js/test` を維持
- 文字列は必ず template literal
- CodeMirror LSP に寄せて「余計な抽象化・独自仕様」を排除
- iPhone Safari（ESM + Worker module 対応）を前提

---

## 今後の拡張

- incremental parsing
- CodeMirror LSP の diagnostics push
- hover / completion の段階的実装
- worker-rpc.js のファイル分割（ロジックが増えたら実施）
