# Demo

该项目运行后会把摘要追加到 Notion 页面末尾，结构为：

- 一个 **日期区间 Toggle**：标题带“有效邮件数量”
- Toggle 内部每封邮件：
  - 一行 **可点击标题（链接到 Outlook 原邮件 webLink）** + `From/At`
  - 若干 bullets：摘要与行动项

## 示例（示意）

```text
▶ 邮件摘要 2026-03-11 ~ 2026-03-18（有效 7）
  - [Blue Link] 项目评审会议时间调整  —  From: boss@company.com · At: 2026-03-18T06:10:00Z
    • 会议改到周四 16:00，参会人不变
    • 需要在会前补充 PRD 风险点
```

## 一键跑通

```bash
pnpm install
cp .env.example .env
pnpm run outlook:auth
pnpm run start
```

