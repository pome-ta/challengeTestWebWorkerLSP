# LSP 実装ロードマップ（Phase 全体像）

本ドキュメントは、これまで積み上げてきた Phase 1〜8 を **一本のロードマップとして可視化** し、
「いつ終わるのか」「どこまでやれば実用か」「どこからは拡張か」
を明確にすることを目的とする。

---

## 全体像（俯瞰）

```
基盤層 ────────────────────────────────┐
 Phase 1–3  : RPC / VFS / initialize        │ 破壊不可
 Phase 4–6  : document lifecycle             │ （土台）
 Phase 7    : incremental sync / diagnostics │

機能層 ────────────────────────────────┤
 Phase 8    : completion / hover（経路）     │ ← 今ここ
 Phase 9    : completion / hover（実体）     │
 Phase 10   : signatureHelp / go-to-def      │

統合層 ────────────────────────────────┤
 Phase 11   : CodeMirror 本格統合             │
 Phase 12   : パフォーマンス / 安定化         │
```

---

## Phase 別の意味付け

### Phase 1–3：基盤確立（完了）

**目的**
- JSON-RPC が壊れない
- VFS が LSP から見える

**この Phase の価値**
- 以降すべての Phase の前提
- ここが壊れると全部壊れる

**状態**: 完了・固定

---

### Phase 4–6：Document Lifecycle（完了）

**目的**
- didOpen / didChange / didClose
- multi-file 安全性

**この Phase の価値**
- LSP として「編集している」という事実が成立
- CodeMirror 連携の最低条件

**状態**: 完了・固定

---

### Phase 7：Incremental Sync / Diagnostics（完了）

**目的**
- version 管理
- 差分更新
- diagnostics の発火

**この Phase の価値**
- 実用レベルの編集体験への入口

**状態**: 完了・固定

---

### Phase 8：Completion / Hover（経路確立）【現在】

**目的**
- completion / hover が「通る」
- CodeMirror → Worker → LSP → Response

**重要な割り切り**
- 中身は空でよい
- 精度は問わない

**意味**
- "LSP が UI と繋がった" ことの証明

---

## ここから先は「無限ではない」

### Phase 9：Completion / Hover（実体）

**やること**
- TS LS の結果をそのまま返す
- 表示できる hover 情報を返す

**ゴール**
- エディタとして「使える」

---

### Phase 10：ナビゲーション系

**候補**
- definition
- references
- rename（最小）

**位置づけ**
- あれば強いが、必須ではない

---

### Phase 11：CodeMirror 本格統合

**目的**
- UX 調整
- request の間引き
- race condition 最終解消

**ここでやっと UI 側の話が主役になる**

---

### Phase 12：安定化・最適化

**内容**
- パフォーマンス
- メモリ
- LS 再起動耐性

**これは「製品化フェーズ」**

---

## 明確な「ゴールライン」

### 技術的ゴール

- Phase 9 完了
  - completion / hover が実体を持つ
  - CodeMirror で普通に使える

### プロジェクト的ゴール

- Phase 11 完了
  - "自作 LSP editor" と言ってよい状態

---

## 重要な認識

- Phase は無限ではない
- Phase 8 までで **LSP 基盤は完成**
- 以降は「価値を足すフェーズ」

---

## 推奨する今後の進め方

1. Phase 8 を確実に固定
2. Phase 9 を最小実装で一気に通す
3. CodeMirror 側で実体験確認
4. 余力があれば Phase 10 以降

---

必要であれば、このロードマップを基に
- **Phase を畳む案**
- **ここで打ち止めにする宣言**
も一緒に設計できる。


---

# Phase 9 仕様（completion / hover 実体化）【最小ゴール定義】

## 目的

Phase 8 で確立した **completion / hover の RPC 経路**に対し、
TypeScript Language Service（TS LS）を実際に接続し、**意味のある 1 件以上の結果を返す**。

本 Phase の目的は **品質ではなく実在性** である。

- 「それっぽい補完が 1 件でも返る」
- 「hover に何らかの型情報が出る」

これをもって Phase 9 完了とする。

---

## Phase 9 の位置づけ

- Phase 8: 経路成立（空でも OK）
- **Phase 9: 実データが返る**
- Phase 10+: 精度・量・UI 改善

Phase 9 は **最初に意味を持った LSP** のフェーズである。

---

## スコープ

### 含む

- TS Language Service を使用した
  - `textDocument/completion`
  - `textDocument/hover`
- single-file 対応
- Phase 7 の incremental sync と整合すること

### 含まない（明示）

- multi-file の import 解決精度
- プロジェクト全体の型推論
- completion の並び順・filterText 調整
- documentation / markdown 整形

---

## 前提条件

- initialize 済み
- document は open 状態
- 最新 version / text が documentState に反映済み

これらを満たさない場合は Phase 8 と同じ挙動（空 or null）。

---

## completion 実体化仕様（最小）

### 実装方針

- TS LS の `getCompletionsAtPosition` を使用
- 返却結果の **先頭 1 件のみ** を LSP CompletionItem に変換

### completion の最小保証

- `items.length >= 1`
- `item.label` が文字列である

### CompletionItem（最小）

```ts
{
  label: string,
  kind: CompletionItemKind.Text
}
```

---

## hover 実体化仕様（最小）

### 実装方針

- TS LS の `getQuickInfoAtPosition` を使用
- `displayParts` を文字列連結して返す

### hover の最小保証

- `contents.value` が空文字でない

### Hover（最小）

```ts
{
  contents: {
    kind: 'plaintext',
    value: string
  }
}
```

---

## 失敗時の扱い

- TS LS が未初期化
- 対象 position が不正
- API が null を返す

いずれも **エラーにしない**。

- completion → 空配列
- hover → null

---

## multi-file に対する扱い（暫定）

Phase 9 では **開いている file のみ** を対象とする。

---

## テスト観測方針

- completion: `items.length >= 1`
- hover: `contents.value.length > 0`

---

## Phase 9 完了条件

- Phase 1〜8 の全テストが green
- Phase 9 completion テストが green
- Phase 9 hover テストが green
- CodeMirror 上で hover / completion が何か出る

---

## 次フェーズ候補（Phase 10）

- multi-file completion
- import 解決
- completion sorting / filtering
- hover markdown 整形

