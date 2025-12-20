# Phase 7 仕様（incremental sync / diagnostics）【確定】

## 目的

Phase 6 までで確立した **document lifecycle（open / change / close / multi-file）** を前提として、
LSP が実運用で必須とする以下 2 点を段階的に導入する。

- incremental sync（差分更新）
- diagnostics（解析結果通知）

本 Phase は **設計仕様の確定のみ** を目的とし、
Language Service の高度な挙動や最適化は扱わない。

---

## Phase 7 スコープ

### 含む

- `textDocument/didChange` の incremental sync 対応
- full sync と incremental sync の切替条件
- diagnostics の最小発火モデル

### 含まない（明示）

- semantic tokens
- completion / hover 高度化
- workspace symbols
- project-wide diagnostics

---

## incremental sync 仕様（最小）

### 同期方式

- Phase 7 では **LSP Incremental Sync（range + text）** のみを扱う
- full text sync は fallback としてのみ使用可能

### didChange payload

```json
{
  "textDocument": {
    "uri": "file:///test.ts",
    "version": 2
  },
  "contentChanges": [
    {
      "range": { /* start/end */ },
      "text": "<delta>"
    }
  ]
}
```

### 適用ルール

- range が指定されている場合、document.text に差分適用する
- 適用後の text が document state の唯一の正とする
- version は **常に +1**

---

## diagnostics 仕様（最小）

### 発火タイミング

- didOpen 後
- didChange 適用後

### 内容

- diagnostics は **配列で返す**
- 空配列は「問題なし」を意味する

```json
{
  "uri": "file:///test.ts",
  "diagnostics": []
}
```

### 方針

- Phase 7 では **常に空 diagnostics を返してよい**
- 目的はライフサイクルと通知タイミングの固定

---

## initialize 前後ルール

Phase 6 までのルールを完全踏襲する。

- initialize 前
  - incremental didChange は発火しない
  - diagnostics も発火しない

- initialize 後
  - didChange → diagnostics の順で発火

---

## multi-file における保証

- incremental change / diagnostics は **uri 単位で独立**
- file A の change が file B の diagnostics に影響しない

---

## 観測方法（テスト専用）

Phase 7 では以下の debug API を追加する。

- `lsp/_debug/getLastDidChange`
- `lsp/_debug/getLastDiagnostics`

これらは **最後に発火した事実のみ** を返す。

---

## Phase 7 完了条件

- incremental sync による text 再構築が破綻しない
- version が常に単調増加する
- diagnostics が正しいタイミングで 1 回だけ観測できる
- Phase 1〜6 の全テストが破壊されていない

---

## 次フェーズ候補（Phase 8）

- completion / hover の実体化
- diagnostics の実内容実装
- incremental sync の最適化

