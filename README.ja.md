<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-guardian/readme.png" width="400" alt="claude-guardian" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/claude-guardian/actions"><img src="https://github.com/mcp-tool-shop-org/claude-guardian/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-guardian/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Claude Code用のフライトコンピュータ — ログローテーション、ウォッチドッグ機能、クラッシュ時の情報収集、およびMCP（Monitoring and Control Plane）の自己監視機能。

Claude Guardianは、Claude Codeのセッションを正常に保つためのローカルな信頼性レイヤーです。 ログの肥大化、ディスク容量不足、およびシステム停止を事前に検出し、問題が発生した場合に証拠を収集し、Claudeがセッション中に自己監視できるようにするためのMCPサーバーを提供します。

## 機能

| コマンド | 目的 |
|---------|---------|
| `preflight` | Claudeプロジェクトのログをスキャンし、サイズが大きすぎるディレクトリ/ファイルを報告し、必要に応じて自動的に修正します。 |
| `doctor` | システム情報、ログの末尾部分、およびジャーナルを含む診断情報をまとめたzipファイルを生成します。 |
| `run -- <cmd>` | ウォッチドッグ機能付きで任意のコマンドを実行し、クラッシュまたは停止時に自動的に情報を収集します。 |
| `status` | ディスクの空き容量、ログのサイズ、警告などを確認します。 |
| `watch` | バックグラウンドデーモンとして、継続的な監視、インシデントの追跡、およびリソース制限の適用を行います。 |
| `budget` | 並行処理の制限（表示/取得/リリース）を管理します。 |
| `mcp` | Claude Codeの自己監視のためのMCPサーバー（8つのツール）を起動します。 |

## インストール

```bash
npm install -g claude-guardian
```

または、直接実行します。

```bash
npx claude-guardian preflight
```

## クイックスタート

### 環境を確認します

```bash
claude-guardian status
```

```
=== Claude Guardian Preflight ===

Disk free: 607.13GB [OK]
Claude projects: C:\Users\you\.claude\projects
Total size: 1057.14MB

Project directories (by size):
  my-project: 1020.41MB

Issues found:
  [WARNING] Project log dir is 1020.41MB (limit: 200MB)
  [WARNING] File is 33.85MB (limit: 25MB)

[guardian] disk=607.13GB | logs=1057.14MB | issues=2
```

### ログの肥大化を自動的に修正します

```bash
claude-guardian preflight --fix
```

古いログをgzip圧縮し、サイズが大きすぎる`.jsonl`または`.log`ファイルを、最後のN行に切り詰めます。 すべてのアクションは、追跡のためにジャーナルファイルに記録されます。

### クラッシュレポートを生成します

```bash
claude-guardian doctor --out ./bundle.zip
```

以下の内容を含むzipファイルを作成します。
- `summary.json`：システム情報、ファイルサイズレポート、事前チェックの結果
- `log-tails/`：各ログファイルの最後の500行
- `journal.jsonl`：Guardianが行ったすべての操作

### ウォッチドッグ機能付きで実行します

```bash
claude-guardian run -- claude
claude-guardian run --auto-restart --hang-timeout 120 -- node server.js
```

ウォッチドッグ機能：
1. コマンドを子プロセスとして起動します。
2. 標準出力/標準エラー出力を監視します。
3. `--hang-timeout`秒間、アクティビティがない場合 → 診断情報を収集します。
4. プロセスがクラッシュした場合 → 情報を収集し、必要に応じてバックオフ付きで再起動します。

## MCPサーバー（真の機能拡張）

Claudeが自己監視できるように、GuardianをローカルMCPサーバーとして登録します。

`~/.claude.json`に追加します。

```json
{
  "mcpServers": {
    "guardian": {
      "command": "npx",
      "args": ["claude-guardian", "mcp"]
    }
  }
}
```

その後、Claudeは以下を実行できます。

| ツール | 返却値 |
|------|----------------|
| `guardian_status` | ディスクの状態、ログの状態、プロセス情報、停止のリスク、リソース制限の状態、注意レベル |
| `guardian_preflight_fix` | ログのローテーション/トリミングを実行し、実行前後のレポートを返します。 |
| `guardian_doctor` | 診断情報をまとめたzipファイルを作成し、パスと概要を返します。 |
| `guardian_nudge` | 安全な自動修復：ログが肥大化している場合は修正し、必要に応じて情報を収集します。 |
| `guardian_budget_get` | 現在の並行処理上限、使用中のスロット数、アクティブなリース |
| `guardian_budget_acquire` | 並行処理スロットを要求します（リースIDを返します）。 |
| `guardian_budget_release` | 重い処理が完了したら、リースを解放します。 |
| `guardian_recovery_plan` | 具体的なツールを呼び出す、段階的な復旧計画 |

これにより、Claudeは次のように言えます。 *"注意レベルは警告です。`guardian_nudge`を実行し、その後、並行処理を削減します。"*

## 設定

設定項目（残りはデフォルト値で設定されています）。

| フラグ | デフォルト値 | 説明 |
|------|---------|-------------|
| `--max-log-mb` | `200` | プロジェクトログディレクトリの最大サイズ（MB） |
| `--hang-timeout` | `300` | 停止とみなすまでの非アクティブ時間（秒） |
| `--auto-restart` | `false` | クラッシュまたは停止時に自動的に再起動するかどうか |

さらに、ハードコーディングされた制限事項：
- **ディスクの空き容量が5GB未満** → 積極的なモードが自動的に有効になります（保持期間の短縮、閾値の引き下げ）。

## 信頼モデル

Claude Guardianは**ローカルでのみ動作**します。 ネットワークリスナー、テレメトリー機能、およびクラウドへの依存はありません。

**読み込む情報:** `~/.claude/projects/`（ログファイル、サイズ、最終更新日時）、プロセスリスト（Claude関連プロセスのCPU使用率、メモリ使用量、稼働時間、ハンドル数 - `pidusage`を使用）。

**書き込む情報:** `~/.claude-guardian/`（state.json、budget.json、journal.jsonl、診断情報）。 すべてのファイルは、ユーザーのホームディレクトリに保存されます。

**収集する情報:** システム情報（OS、CPU、メモリ、ディスク）、ログファイルの末尾部分（最新500行）、プロセスの一時的なスナップショット、およびGuardian自身のログ。APIキー、トークン、認証情報、またはユーザーコンテンツは収集しません。

**危険な操作 — Guardianが行わないこと:**
- プロセスの停止またはシグナルの送信（`SIGKILL`や`SIGTERM`は送信しません）
- Claude Codeまたはその他のプロセスの再起動
- ファイルの削除（ローテーションはgzip形式、トリミングは最新N行を保持）
- ネットワークリクエストの送信や、サーバーへの情報送信
- 特権の昇格や、他のユーザーのデータへのアクセス

プロセス停止や自動再起動機能が将来追加される場合でも、明示的なオプション設定が必要となり、デフォルトでは無効になります。詳細はここに記載されます。

## 設計原則

- **根拠に基づいた判断:** すべての操作はログに記録され、クラッシュ時の情報は推測ではなく、実際の状態を捉えます。
- **決定論的:** 機械学習や、ファイルの日付やサイズ以外のヒューリスティックは使用しません。60秒で理解できる決定テーブルを使用します。
- **デフォルトで安全:** ローテーションはgzip形式（復元可能）、トリミングは最新N行を保持（データは保持）、v1では削除は行いません。
- **シンプルな依存関係:** commander、pidusage、archiver、@modelcontextprotocol/sdk。これらが全てです。

## 開発

```bash
npm install
npm run build
npm test
```

## ライセンス

MIT

---

開発元: <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
