# Email → Notion Agent（Outlook/Gmail）

把“收件箱里的信息流”产品化：自动拉取最近 \(N\) 天邮件 → 本地规则筛掉明显噪音 → 用 LLM 生成可执行摘要 → 同步到 Notion，形成每日/每周可追踪的 Inbox Digest。

如果你在做个人效率工具、知识管理产品，或想把“AI + 工程化落地”写进简历，这个项目更像一个可上线的 **agent 化小产品**，而不只是 demo。

## 亮点（面向简历展示）

- **产品化的信息呈现**：Notion 内按“日期区间 Toggle（含有效邮件数）”组织；每封邮件标题可点击直达原文，并显示 **From/At** 元信息，方便直接回复处理。
- **确定性与稳定性**：把“是否有效”的判定从 LLM 移到本地保守规则；LLM 只负责摘要，并用 `temperature: 0` 固定生成，避免同一输入导致有效数波动。
- **多后端接入 & 降级策略**：
  - Outlook：OAuth2 Device Code Flow + Microsoft Graph（推荐）
  - IMAP：作为兜底（含端口/TLS/连接重试策略）
  - Notion：优先官方 MCP，失败自动回退到 Notion API（避免 MCP 启动失败导致写入中断）
- **工程化可维护**：模块化（fetcher / summarizer / notion writer），配置集中在 `.env`，支持白名单、时间窗口等可控参数。

## 功能概览

- **Outlook（推荐）**：OAuth2 + Graph 拉取收件箱邮件，拿到 `webLink`，在 Notion 里直链原文
- **Gmail（可选）**：Gmail API（OAuth2）或 IMAP
- **本地规则过滤**：只排除“非常明确”的噪音（退订、明显促销、no-reply 验证码/系统通知、退信等）
- **LLM 摘要（Qwen / OpenAI Compatible）**：对每封“已判定有效”的邮件生成 title + bullets
- **Notion 写入**：追加一个 Toggle 块（区间标题 + 有效数），内部每封邮件一个可点击条目 + bullets

## 系统设计

### 主流程

```mermaid
flowchart LR
  A[Email Sources\nOutlook Graph / IMAP / Gmail API] --> B[Fetch\nlast N days]
  B --> C[Local filter\nobvious noise only]
  C --> D[LLM summarize\n(deterministic)]
  D --> E[Write to Notion\nMCP → API fallback]
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

运行后会在 Notion 页面末尾追加一个 Toggle：

- 标题：`邮件摘要 YYYY-MM-DD ~ YYYY-MM-DD（有效 X）`（区间由 `EMAIL_DAYS` 决定）
- 内容：每封邮件一行“蓝色可点击标题 + From/At”，下面跟随 bullets

## Notion 配置

1. 在 [Notion 集成](https://www.notion.so/my-integrations) 新建集成，复制 key 到 `NOTION_TOKEN`
2. 在要写入的页面右上角「…」→ 连接到你的集成
3. 从页面 URL 拿到 `NOTION_PAGE_ID`（32 位，可带 `-`）

> 说明：运行时会尝试用 Notion MCP（`npx @notionhq/notion-mcp-server`）。若你本机 npm cache 权限异常导致 MCP 启动失败，程序会自动回退到 Notion API 直写，保证“摘要写入”不被阻断。

## 配置项

| 变量 | 默认 | 说明 |
|------|------|------|
| `EMAIL_DAYS` | `7` | 拉取最近 N 天；同时用于 Notion Toggle 日期区间命名 |
| `EMAIL_ALLOW_SENDERS` | 空 | 发件人白名单（逗号分隔），用于收敛输入规模 |
| `MODEL_NAME` | `qwen-turbo` | OpenAI Compatible 的模型名 |

## 代码结构

```text
src/
  index.mjs                  # orchestration & title range naming
  outlook-graph-fetcher.mjs   # Outlook Graph fetch + webLink
  outlook-oauth.mjs           # OAuth2 refresh + device code helper
  imap-fetcher.mjs            # IMAP fallback + retries
  summarizer.mjs              # local filter + deterministic LLM summary
  notion-client.mjs           # Notion toggle writer (MCP → API fallback)
```

## 可扩展方向（面向产品/工程演进）

- **状态同步**：把“是否已处理/是否需要回复”写回 Notion database，形成闭环
- **增量同步**：记录 lastSync watermark，避免重复写入
- **可观测性**：结构化日志 + tracing，把每次 run 的输入规模/过滤原因/写入结果沉淀成指标
- **前端展示**：做一个 Dashboard（Next.js + Notion 数据库）展示趋势与待办队列

## License

MIT
