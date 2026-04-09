# Email → Notion Agent（Outlook/Gmail）

把“收件箱里的信息流”产品化：自动拉取最近 \(N\) 天邮件 → 本地规则筛掉明显噪音 → 用 LLM 生成摘要 → 同步到 Notion 交互面板，形成可维护的 Inbox Digest。

如果你在做个人效率工具、知识管理产品，或希望把“AI + 工程化落地”做成可长期使用的工具，这个项目更像一个可上线的 **agent 化小产品**，而不只是 demo。

## 亮点

- **产品化的信息呈现**：优先写入 Notion 交互式面板，拆成 `Do Now / This Week / Watch` 三张 inline database；邮件标题本身直链原文，适合直接在 Notion 里筛选、改状态、做轻量整理。
- **确定性与稳定性**：把“是否有效”的判定从 LLM 移到本地保守规则；LLM 只负责摘要，并用 `temperature: 0` 固定生成，避免同一输入导致有效数波动。
- **多后端接入 & 降级策略**：
  - Outlook：OAuth2 Device Code Flow + Microsoft Graph（推荐）
  - IMAP：作为兜底（含端口/TLS/连接重试策略）
  - Notion：优先交互式 database 面板；若 database 写入失败，自动回退到静态表格块，避免摘要中断
- **工程化可维护**：模块化（fetcher / summarizer / notion writer），配置集中在 `.env`，支持白名单、时间窗口等可控参数。

## 功能概览

- **Outlook（推荐）**：OAuth2 + Graph 拉取收件箱邮件，拿到 `webLink`，在 Notion 里直链原文
- **Gmail（可选）**：Gmail API（OAuth2）或 IMAP
- **本地规则过滤**：只排除“非常明确”的噪音（退订、明显促销、no-reply 验证码/系统通知、退信等）
- **LLM 摘要（Qwen / OpenAI Compatible）**：对规则层不确定的邮件做兜底分类，并生成简短摘要
- **Notion 写入**：
  - 优先：三张交互式 inline database（`Do Now / This Week / Watch`）
  - 回退：单个 Toggle + 静态表格块
- **用户意图记忆**：
  - `This Week` 中被你手动改成 `LOW` 的邮件，后续会自动清理并 suppress
  - `Watch` 中被你手动改成 `DONE` 的邮件，后续会自动清理并 suppress
  - suppress 记录默认保留 `30` 天，之后自动过期

## 系统设计

### 主流程

```mermaid
flowchart LR
  A[Email Sources\nOutlook Graph / IMAP / Gmail API] --> B[Fetch\nlast N days]
  B --> C[Local filter\nobvious noise only]
  C --> D[Apply suppressions\nremember user intent]
  D --> E[LLM summarize\n(deterministic)]
  E --> F[Maintain Notion panels\narchive LOW/DONE rows]
  F --> G[Write digest if changed\nDB → static table fallback]
```

### 为什么“有效邮件”不交给 LLM？

“有效/无效”是灰度判断，模型会产生波动，导致同一批邮件两次运行有效数差异很大。这里用 **可解释、可回归** 的本地规则做过滤（只过滤非常确定的噪音），其余都保留，LLM 只做摘要，整体更稳定，更适合长期运行。

## 快速开始（Outlook OAuth2，推荐）

### 1) 安装

```bash
pnpm install
```

### 2) 配置环境变量

复制示例并填写：

```bash
cp .env.example .env
```

至少需要：

- `OUTLOOK_CLIENT_ID`、`OUTLOOK_REFRESH_TOKEN`（Outlook OAuth2）
- `OPENAI_API_KEY`（以及可选的 `OPENAI_BASE_URL`、`MODEL_NAME`）
- `NOTION_TOKEN`、`NOTION_PAGE_ID`
- `EMAIL_DAYS`（决定 Notion Toggle 的日期区间标题）

### 3) 获取 Outlook refresh_token（仅首次）

```bash
pnpm run outlook:auth
```

按提示打开链接、输入设备码并授权。终端会输出 `OUTLOOK_REFRESH_TOKEN=...`，追加到 `.env`。

### 4) 运行

```bash
pnpm run start
```

运行后会优先在 Notion 页面写入三张交互式面板：

- `Do Now`
- `This Week`
- `Watch`

其中：
- `邮件` 列标题本身直链原邮件
- `状态`、`优先级` 等字段可直接在 Notion 内交互
- 若交互式 database 写入失败，会自动回退到静态表格块

## Demo（示例输出）

Notion 中的结构大致如下（示意）：

```text
Do Now
  邮件 | 发件人 | 截止 | 优先级 | 状态 | 摘要 | 批次

This Week
  邮件 | 截止 | 优先级 | 状态 | 摘要 | 批次

Watch
  邮件 | 状态 | 批次
```

复现 demo 的最短路径：

```bash
pnpm install
cp .env.example .env
pnpm run outlook:auth   # 首次获取 OUTLOOK_REFRESH_TOKEN
pnpm run start
```

## Notion 配置

1. 在 [Notion 集成](https://www.notion.so/my-integrations) 新建集成，复制 key 到 `NOTION_TOKEN`
2. 在要写入的页面右上角「…」→ 连接到你的集成
3. 从页面 URL 拿到 `NOTION_PAGE_ID`（32 位，可带 `-`）

> 说明：程序优先通过 Notion API 维护三张交互式 database 面板；如果数据库 schema 不兼容或 API 写入失败，会自动回退到静态表格块，保证摘要不中断。

## 配置项

| 变量 | 默认 | 说明 |
|------|------|------|
| `EMAIL_DAYS` | `7` | 拉取最近 N 天；同时用于 Notion Toggle 日期区间命名 |
| `EMAIL_ALLOW_SENDERS` | 空 | 发件人白名单（逗号分隔），用于收敛输入规模 |
| `MODEL_NAME` | `qwen-turbo` | OpenAI Compatible 的模型名 |
| `REMINDER_CHANNELS` | `console` | 升级提醒通道（`console,telegram,email` 逗号分隔） |
| `EVAL_FN_MAX` | `0.08` | 评估门禁允许的最大 FN 比例 |
| `SUPPRESSION_RETENTION_DAYS` | `30` | 用户在 Notion 中手动清理出的 suppress 记录保留天数 |

## Notion 面板行为

程序会把 Notion 页面当作一个轻量行动面板，而不是永久日志页。

- `Do Now`：按截止时间升序
- `This Week`：按优先级，再按截止时间排序
- `Watch`：极简观察面板，只保留 `邮件 / 状态 / 批次`

每次运行前会先做面板维护：

- `This Week` 中被你手动改成 `LOW` 的邮件会被归档
- `Watch` 中被你手动改成 `DONE` 的邮件会被归档
- 这些被你明确“降级/完成”的邮件会进入本地 suppression 表，后续默认不再重新进入表格
- suppress 记录默认只保留 `30` 天，之后自动清理

幂等规则也做了区分：

- `Notion 清理` 每次都执行
- `新增 digest 写入` 仅在摘要内容发生变化时执行

所以你在 Notion 里的交互不会再被“命中幂等键”吞掉。

## 提醒通道

- `console`：默认通道，写到日志（用于本地调试）
- `telegram`：需要 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`
- `email`：需要 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`REMINDER_EMAIL_TO`

通道可并行启用，例如：

```bash
REMINDER_CHANNELS=telegram,email
```

## 质量门禁（测试 + Eval）

```bash
pnpm run gate:quality
```

该命令会执行：
- `pnpm test`（单元测试）
- `pnpm eval`（在 `eval/samples.jsonl` 上计算 FN/FP/precision/recall）

当 `fn_rate > EVAL_FN_MAX` 时，`pnpm eval` 会返回非 0，阻断 CI。

## 代码结构

```text
src/
  index.mjs                  # orchestration & title range naming
  outlook-graph-fetcher.mjs   # Outlook Graph fetch + webLink
  outlook-oauth.mjs           # OAuth2 refresh + device code helper
  imap-fetcher.mjs            # IMAP fallback + retries
  summarizer.mjs              # local filter + deterministic LLM summary + suppress filtering
  notion-client.mjs           # Notion interactive panel writer + cleanup + static fallback
  state-db.mjs                # sqlite state, idempotency, suppressions
  suppression-key.mjs         # stable key builder for user-intent suppression
```

## 可扩展方向（面向产品/工程演进）

- **增量同步**：记录 lastSync watermark，避免重复写入
- **可观测性**：结构化日志 + tracing，把每次 run 的输入规模/过滤原因/写入结果沉淀成指标
- **前端展示**：做一个 Dashboard（Next.js + Notion 数据库）展示趋势与待办队列

## License

MIT
