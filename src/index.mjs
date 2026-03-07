/**
 * Agent: 拉取邮箱有效邮件 → 总结 → 更新 Notion 页面
 * 支持 Outlook（OAuth2 + Graph / IMAP）、Gmail（OAuth2）。使用方式：配置 .env 后执行 node src/index.mjs
 */
import './load-env.mjs';

import { fetchEmailsFromGmail, isGmailConfigured } from './email-fetcher.mjs';
import { fetchEmailsFromImap, isImapConfigured } from './imap-fetcher.mjs';
import { fetchEmailsFromOutlookGraph, isOutlookOAuthConfigured } from './outlook-graph-fetcher.mjs';
import { filterAndSummarize } from './summarizer.mjs';
import { appendSummaryToNotion } from './notion-client.mjs';

async function main() {
  console.log('开始拉取邮件…');

  const hasMail =
    isOutlookOAuthConfigured() || isGmailConfigured() || isImapConfigured();
  if (!hasMail) {
    console.error(
      '请配置邮箱（任选其一）：\n' +
        '  Outlook OAuth2（推荐）：OUTLOOK_CLIENT_ID + OUTLOOK_REFRESH_TOKEN，首次运行 pnpm run outlook:auth 获取\n' +
        '  Outlook IMAP：IMAP_USER、IMAP_PASSWORD（应用密码）\n' +
        '  Gmail：GMAIL_CLIENT_ID、GMAIL_CLIENT_SECRET、GMAIL_REFRESH_TOKEN'
    );
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('未配置 OPENAI_API_KEY');
    process.exit(1);
  }
  const hasNotionAuth = !!(process.env.NOTION_TOKEN || process.env.NOTION_API_KEY);
  const notionPageId = (process.env.NOTION_PAGE_ID || '').trim();
  if (!hasNotionAuth) {
    console.error('未配置 NOTION_TOKEN 或 NOTION_API_KEY');
    process.exit(1);
  }
  if (!notionPageId) {
    console.error(
      '未配置 NOTION_PAGE_ID。请打开要写入摘要的 Notion 页面，从浏览器地址栏复制页面 ID（URL 末尾 32 位，可含 -）到 .env 的 NOTION_PAGE_ID'
    );
    process.exit(1);
  }

  let emails;
  if (isOutlookOAuthConfigured()) {
    emails = await fetchEmailsFromOutlookGraph();
    console.log('Outlook OAuth2 连接成功');
  } else if (isGmailConfigured()) {
    emails = await fetchEmailsFromGmail();
  } else {
    emails = await fetchEmailsFromImap();
  }
  console.log(`拉取到 ${emails.length} 封邮件，正在筛选并总结…`);

  const summary = await filterAndSummarize(emails);
  console.log(`有效邮件数: ${summary.validCount}，标题: ${summary.summaryTitle}`);

  await appendSummaryToNotion(summary);
  console.log('已更新 Notion 页面。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
