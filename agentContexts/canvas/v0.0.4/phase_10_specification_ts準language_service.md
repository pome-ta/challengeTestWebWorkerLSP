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

