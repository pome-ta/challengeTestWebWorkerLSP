# Phase 10 Specification

## 目的

Phase 10 は **TypeScript "準" Language Service 接続フェーズ** とする。

ここでの目的は、**Node.js 前提を一切排除した browser / Web Worker 環境** において、TypeScript Compiler API を直接用い、

- ソースコードが TypeScript により実際に解析されていること
- completion / hover が **ソース内容依存で変化すること**

を確認・保証することである。

本フェーズは **完全な Language Service 互換** を目標としない。

---

## 非目標（明確な禁止事項）

以下は Phase 10 では **行わない**：

- `ts.createLanguageService` の使用
- `getDefaultLibFilePath` の使用
- Node.js API 依存（`fs`, `path`, `process` 等）
- Node 実行を前提とした設計
- 完全な lib.d.ts 環境の構築

これらは Phase 11 以降の責務とする。

---

## 技術方針

### TypeScript 利用範囲

Phase 10 では **Compiler API のみ** を使用する。

- `ts.createSourceFile`
- `ts.createProgram`
- `program.getTypeChecker()`
- `ts.getPreEmitDiagnostics(program)`

Language Service に依存する API は一切使用しない。

---

## 内部モデル

### Document 管理

- Phase 4–9 で確立した `documents: Map<uri, { version, text }>` を **完全維持**
- 各 request ごとに documents から SourceFile を生成

### Program 構築

- Program は request 単位、もしくは簡易キャッシュで生成
- 1 document / multi-document 両対応
- CompilerOptions は browser 安全な最小構成

---

## Completion 仕様（Phase 10）

### 入力

- `textDocument.uri`
- `position`

### 処理

- 対象 SourceFile を AST 化
- position 近傍の Node を特定
- Symbol / Scope を限定的に走査

### 出力要件

- completion.items が **空でない**
- item.label がソースコード依存で変化
- 種類は限定（Variable / Function 程度で可）

完全網羅は不要。

---

## Hover 仕様（Phase 10）

### 入力

- `textDocument.uri`
- `position`

### 処理

- Node → Symbol を解決
- TypeChecker を使用

### 出力要件

- hover.contents.value が **TypeScript 由来情報**
- symbol 名 / 型名のいずれかを含む

---

## Diagnostics（任意・加点要素）

- `ts.getPreEmitDiagnostics` を使用
- LSP diagnostics 形式に完全変換する必要はない

---

## 成功条件（合格基準）

以下を満たせば Phase 10 完了とする：

- browser / iOS Safari 上で worker が安定起動
- `ts.createProgram` が例外なく動作
- completion / hover が **固定値でない**
- Node.js 依存が存在しない

---

## Phase 11 への引き継ぎ

Phase 10 の成果物は以下を Phase 11 に引き継ぐ：

- Document / Program 管理モデル
- Compiler API ベース実装
- Node 非依存前提

Phase 11 では：

- lib.d.ts 完備
- ATA
- editor（CodeMirror）実接続

を行う。

---

## 位置づけ

Phase 10 は、

> TypeScript が **browser worker で実用的に生きている**

ことを証明するフェーズである。


---

# Phase 9 仕様（確定版）

## 目的
Completion / Hover が **具体的コンテンツを返す**ことを確認し、LSP レベルでの結果生成が安定している状態を仕様として固定する。

## スコープ
- 対象機能
  - Completion Items の提示
  - Hover 情報の提示
- 情報源
  - 既存の LSP もしくは仮実装の静的データ

## 達成条件（Acceptance Criteria）
1. Completion 要求に対し、空配列ではない候補リストを返す
2. Hover 要求に対し、空文字列ではない `contents` を返す
3. 返却値は **人間が読める具体的テキスト** を含む
4. 型情報の有無は問わない（Phase 10 の対象とする）
5. Phase 9 の成功は Phase 10 の実装有無に依存しない

## 非スコープ（Out of Scope）
- TypeScript Compiler API による型解決
- TypeChecker に基づく hover contents 拡張
- エディタ統合の UI 表示品質

## 成功判定の観点
- Completion 結果は取得できる
- Hover 結果は取得できる
- いずれも「取得できない」「例外」「空」の状態ではない

---

# Phase 10 仕様（TS Compiler API ベース Hover/Completion）

## 目的
Hover および Completion の情報源として **TypeScript Compiler API（Program / TypeChecker）を利用**し、型情報を含む結果を返すこと。

## 要件
### 機能要件
1. Hover 情報に **型情報（例: `number`, `string`, 関数シグネチャ等）** が含まれる
2. 情報源は TypeScript Compiler API の `TypeChecker` に基づく
3. Completion および Hover のいずれか、または両方に型情報が反映される

### 技術要件
- `ts.createProgram` または LanguageService を通じて Program を構築
- `Program.getTypeChecker()` により TypeChecker を取得
- `checker.getTypeAtLocation(node)` または相当 API を利用
- Virtual File System（VFS）と Program の同期が取れている

### 最低限の成功条件
- Hover 結果内に **型を示す文字列が含まれる**
  - 例: `: number`, `: string`, `(): void` 等

## 成功判定（テスト観点）
- Phase 9 のテストはすべて継続して成功
- Phase 10 の追加テストにて以下が成立
  - Hover 文字列に型情報を含む
  - `hover does not include type info` が発生しない

## 実装に関する制約
- 既存設計（LspServerCore / LSPWorker 構成）を保持
- 可能な限り LSP の既存メカニズムを活用
- 不要なカスタム実装は追加しない

## 非スコープ
- 型エラーメッセージの詳細化
- 全 TS 機能の網羅的型解決
- パフォーマンス最適化

## ログ/デバッグ要件
- Program 生成有無
- SourceFile 数
- Checker 利用の成否

## 失敗時の既知症状（想定）
- hover 文字列に型情報が含まれない
- Program が再生成されていない
- VFS と Program の不整合

---

この仕様に基づき、次工程として **worker 実装（Phase 10 対応）** を行う。
