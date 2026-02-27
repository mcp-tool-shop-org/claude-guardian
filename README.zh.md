<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-guardian/readme.png" width="400" alt="claude-guardian" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/claude-guardian/actions"><img src="https://github.com/mcp-tool-shop-org/claude-guardian/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-guardian/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Claude Code 的飞行计算机：日志轮转、看门狗、崩溃报告包和 MCP 自我感知功能。

Claude Guardian 是一个本地可靠性层，用于保持 Claude Code 会话的健康状态。它能够检测到日志膨胀、磁盘空间不足和程序卡死等问题，并在出现问题时记录相关信息，并提供一个 MCP 服务器，以便 Claude 可以在会话过程中进行自我监控。

## 功能

| 命令 | 用途 |
|---------|---------|
| `preflight` | 扫描 Claude 项目日志，报告过大的目录/文件，可选自动修复。 |
| `doctor` | 生成包含系统信息、日志片段和日记的诊断报告包（zip 文件）。 |
| `run -- <cmd>` | 使用看门狗功能运行任何命令，并在崩溃/卡死时自动生成报告包。 |
| `status` | 一次性健康检查：磁盘可用空间、日志大小、警告信息。 |
| `watch` | 后台守护进程：持续监控、事件跟踪、预算控制。 |
| `budget` | 查看和管理并发预算（显示/获取/发布）。 |
| `mcp` | 启动 MCP 服务器（8 个工具），用于 Claude Code 的自我监控。 |

## 安装

```bash
npm install -g claude-guardian
```

或者直接运行：

```bash
npx claude-guardian preflight
```

## 快速开始

### 检查您的环境

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

### 自动修复日志膨胀

```bash
claude-guardian preflight --fix
```

轮转旧日志（使用 gzip 压缩），并修剪过大的 `.jsonl` / `.log` 文件，保留最后 N 行。所有操作都会记录到日记文件中，以便追溯。

### 生成崩溃报告

```bash
claude-guardian doctor --out ./bundle.zip
```

创建一个包含以下内容的 zip 文件：
- `summary.json`：系统信息、文件大小报告、预检结果。
- `log-tails/`：每个日志文件的最后 500 行。
- `journal.jsonl`：守护程序执行过的所有操作。

### 使用看门狗功能运行

```bash
claude-guardian run -- claude
claude-guardian run --auto-restart --hang-timeout 120 -- node server.js
```

看门狗功能：
1. 将您的命令作为子进程启动。
2. 监控标准输出/标准错误流，检查是否有活动。
3. 如果在 `--hang-timeout` 秒内没有活动，则生成一个诊断报告包。
4. 如果进程崩溃，则生成一个报告包，并可以选择在退避后重新启动。

## MCP 服务器（真正的解锁功能）

将守护程序注册为本地 MCP 服务器，以便 Claude 可以进行自我监控：

添加到 `~/.claude.json`：

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

然后 Claude 可以调用：

| 工具 | 返回内容 |
|------|----------------|
| `guardian_status` | 磁盘信息、日志信息、进程信息、卡死风险、预算信息、关注级别。 |
| `guardian_preflight_fix` | 轮转/修剪日志，并返回修改前后的报告。 |
| `guardian_doctor` | 生成诊断报告包（zip 文件），并返回路径和摘要。 |
| `guardian_nudge` | 安全自动修复：如果日志膨胀，则修复日志；如果需要，则生成报告包。 |
| `guardian_budget_get` | 当前并发限制、已使用的槽、活动租约。 |
| `guardian_budget_acquire` | 请求并发槽（返回租约 ID）。 |
| `guardian_budget_release` | 完成高强度工作后，释放租约。 |
| `guardian_recovery_plan` | 分步恢复计划，列出要调用的具体工具。 |

这使得 Claude 可以说：“关注级别为警告。正在运行 `guardian_nudge`，然后降低并发量。”

## 配置

三个可配置项（其他所有内容都已使用合理的默认值进行硬编码）：

| 标志 | 默认值 | 描述 |
|------|---------|-------------|
| `--max-log-mb` | `200` | 项目日志目录的最大大小（MB）。 |
| `--hang-timeout` | `300` | 在声明为卡死之前的空闲时间（秒）。 |
| `--auto-restart` | `false` | 崩溃/卡死时自动重启。 |

以及一个硬编码的保护机制：
- **磁盘可用空间 < 5GB** → 自动启用激进模式（缩短保留时间，降低阈值）。

## 信任模型

Claude Guardian 仅为 **本地使用**。它没有网络监听功能，没有遥测功能，也没有任何云端依赖。

**它读取的内容：** `~/.claude/projects/`（日志文件、大小、修改时间），进程列表（通过 `pidusage` 获取 Claude 相关进程的 CPU、内存、运行时间、句柄计数）。

**它写入的内容：** `~/.claude-guardian/`（state.json、budget.json、journal.jsonl、doctor bundles）。所有文件都位于用户的家目录中。

**它收集的信息（以捆绑包形式）：** 系统信息（操作系统、CPU、内存、磁盘）、日志文件片段（最后500行）、进程快照以及守护进程自身的日志。不收集任何API密钥、令牌、凭据或用户内容。

**危险操作——Guardian不会执行的操作：**
- 终止进程或发送信号（不发送`SIGKILL`或`SIGTERM`信号）
- 重启Claude Code或其他进程
- 删除文件（日志轮转采用gzip压缩，日志截断保留最后N行）
- 发起网络请求或向服务器发送数据
- 提升权限或访问其他用户的的数据

如果将来添加了进程终止或自动重启功能，它将通过一个明确的启用选项来实现，并在文档中进行说明，并且默认情况下是关闭的。

## 设计原则

- **基于证据，而非猜测**： 每次操作都会记录到日志中；崩溃捆绑包捕获的是状态，而不是猜测。
- **确定性**： 不使用机器学习，超出文件年龄和大小的启发式方法。 您可以在60秒内阅读的决策表。
- **默认安全**： 轮转采用gzip压缩（可逆），截断保留最后N行（数据保留），v1版本不进行任何删除。
- **简单的依赖项**： commander、pidusage、archiver、@modelcontextprotocol/sdk。 仅此而已。

## 开发

```bash
npm install
npm run build
npm test
```

## 许可证

MIT

---

由<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>构建。
