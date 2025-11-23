# Coding Style Guide (v0.0.2.x)

この文書は、プロジェクト全体で統一すべき JavaScript コーディングスタイルを規定する。

---

## 1. 基本ルール

### 1.1 変数宣言
- 変更されない変数 → **const**
- 再代入が必要 → **let**
- var は禁止

### 1.2 文字列
- **必ず template literal (`${}`)** を使用する
- `'a' + b` のような concatenation は禁止

---

## 2. Worker/LSP ルール

### 2.1 Worker 内の postMessage
- **必ず `self.postMessage()` を記述**
- 暗黙の `postMessage()` は禁止

### 2.2 自分自身の参照 (`self.`)
- **worker context のみで使用する**
- 通常 JS モジュール内では `self.` を使わない

---

## 3. JSON-RPC

### 3.1 request
```
{ jsonrpc: "2.0", id, method, params }
```

### 3.2 notification
```
{ jsonrpc: "2.0", method, params }
```

### 3.3 error
```
{
  jsonrpc: "2.0",
  id,
  error: { code, message }
}
```

---

## 4. ロギング

- すべてのログは `postLog()` に集約
- timestamp を含める
- worker 側で console.log 使用禁止

---

## 5. ファイル構造

```
docs/js/
    core/
    util/
    test/
    worker.js
```

- core: ロジック（LSP / VFS）
- util: 共通関数
- test: TDD テスト
- worker.js: JSON-RPC dispatcher

---

## 6. テスト記述規約

### 6.1 Required Sections
- **Expected Behavior**
- **Expected Output**
- **Steps**

### 6.2 test-utils.js の役割
- worker 起動補助
- ready までの handshake
- ログ配信の hook

---

## 7. 可読性

- 1 関数につき 1 役割
- 120 行を超え始めたらファイル分割
- 依存関係は循環参照禁止

---

## 8. コード生成の取り決め

あなた（ChatGPT）との開発ルール:

- 冗長ではなく、**正確・簡潔・モダン**
- v0.0.1.x のコードは参照しない
- 設計方針に合わせて不整合は勝手に修正してよい
- 「変更点のみコメント」する（全体再掲時でも）