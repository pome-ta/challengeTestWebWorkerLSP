# Phase 8 仕様（completion / hover 実体化）【確定案】

## 目的

Phase 7 までで確立した **document lifecycle / incremental sync / diagnostics 発火モデル** を前提として、
エディタ連携において最も基本的な LSP 機能である以下 2 点を実体化する。

- completion（補完）
- hover（ホバー情報）

本 Phase は **「LSP 経路が正しく閉じること」** を最優先とし、
補完品質や型解析の精度は重視しない。

---

## Phase 8 スコープ

### 含む

- `textDocument/completion` の実装
- `textDocument/hover` の実装
- TypeScript Language Service（TS LS）への最小接続
- single-file / multi-file 両対応

### 含まない（明示）

- completion の高度な並び替え・スコアリング
- signatureHelp
- semantic tokens
- workspace symbols
- プロジェクト横断型解析

---

## completion 仕様（最小）

### リクエスト

```json
{
  "textDocument": { "uri": "file:///test.ts" },
  "position": { "line": 0, "character": 5 }
}
```

### 振る舞い

- initialize 後のみ応答
- 対象 document が open 状態であること
- TS LS が存在しない場合は空配列を返す

### レスポンス（最小）

```json
{
  "isIncomplete": false,
  "items": []
}
```

- Phase 8 では **空配列で正解**
- 目的は completion request → response 経路の確立

---

## hover 仕様（最小）

### リクエスト

```json
{
  "textDocument": { "uri": "file:///test.ts" },
  "position": { "line": 0, "character": 5 }
}
```

### 振る舞い

- initialize 後のみ応答
- document が open されていない場合は null

### レスポンス（最小）

```json
{
  "contents": {
    "kind": "plaintext",
    "value": ""
  }
}
```

- Phase 8 では **空文字列で正解**

---

## TypeScript LS 連携方針（最小）

- 既存の `@typescript/vfs` を継続利用
- LS 初期化は Phase 6/7 と同一タイミング
- completion / hover 呼び出し時のみ LS API を使用

※ Phase 8 では LS が未接続でもエラーにしない

---

## initialize 前後ルール

- initialize 前
  - completion / hover は **null または空応答**

- initialize 後
  - completion / hover が 1 回だけ応答する

---

## multi-file における保証

- completion / hover は **uri 単位で完結**
- 他 file の open / close / change に影響されない

---

## 観測方法（テスト専用）

Phase 8 では以下の debug API を追加する。

- `lsp/_debug/getLastCompletion`
- `lsp/_debug/getLastHover`

いずれも **最後に処理された request 内容のみ** を返す。

---

## Phase 8 完了条件

- completion / hover request がエラーなく応答する
- Phase 1〜7 の全テストが破壊されていない
- CodeMirror からの実呼び出し経路が確立可能

---

## 次フェーズ候補（Phase 9）

- completion 実内容の拡張
- hover 情報の型・symbol 表示
- signatureHelp
- CodeMirror UI 最適化

