/**
 * Agent: 拉取邮箱有效邮件 → 总结 → 更新 Notion 页面
 * 支持 Outlook（OAuth2 + Graph / IMAP）、Gmail（OAuth2）。使用方式：配置 .env 后执行 node src/index.mjs
 */
import './load-env.mjs';

import { fetchEmailsFromGmail, isGmailConfigured } from './email-fetcher.mjs';
import { fetchEmailsFromImap, isImapConfigured } from './imap-fetcher.mjs';
import { fetchEmailsFromOutlookGraph, isOutlookOAuthConfigured } from './outlook-graph-fetcher.mjs';
import { buildActionDigest } from './summarizer.mjs';
import { appendSummaryToNotion, maintainNotionPanels } from './notion-client.mjs';
import { createDigestIdempotencyKey } from './digest-idempotency.mjs';
import { enqueueEscalationReminders, processReminderQueue } from './notifier.mjs';
import {
  acquireRunLock,
  finishRun,
  insertAction,
  listSuppressionKeys,
  markNotionWriteIfNew,
  pruneOldSuppressions,
  recordNotionWrite,
  releaseRunLock,
  startRun,
  upsertThreadState,
} from './state-db.mjs';

function formatDateYmd(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log('开始拉取邮件…');
  const runId = `run-${Date.now()}`;
  acquireRunLock(runId);
  startRun(runId);

  try {
    const hasMail =
      isOutlookOAuthConfigured() || isGmailConfigured() || isImapConfigured();
    if (!hasMail) {
      throw new Error(
        '请配置邮箱（任选其一）：\n' +
          '  Outlook OAuth2（推荐）：OUTLOOK_CLIENT_ID + OUTLOOK_REFRESH_TOKEN，首次运行 pnpm run outlook:auth 获取\n' +
          '  Outlook IMAP：IMAP_USER、IMAP_PASSWORD（应用密码）\n' +
          '  Gmail：GMAIL_CLIENT_ID、GMAIL_CLIENT_SECRET、GMAIL_REFRESH_TOKEN'
      );
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('未配置 OPENAI_API_KEY');
    }
    const hasNotionAuth = !!(process.env.NOTION_TOKEN || process.env.NOTION_API_KEY);
    const notionPageId = (process.env.NOTION_PAGE_ID || '').trim();
    if (!hasNotionAuth) {
      throw new Error('未配置 NOTION_TOKEN 或 NOTION_API_KEY');
    }
    if (!notionPageId) {
      throw new Error(
        '未配置 NOTION_PAGE_ID。请打开要写入摘要的 Notion 页面，从浏览器地址栏复制页面 ID（URL 末尾 32 位，可含 -）到 .env 的 NOTION_PAGE_ID'
      );
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

    try {
      await maintainNotionPanels();
    } catch (err) {
      console.warn(`Notion 面板清理失败，将在写入阶段回退到静态块：${err?.message || err}`);
    }
    pruneOldSuppressions();
    const summary = await buildActionDigest(emails, { suppressedKeys: listSuppressionKeys() });
    // Toggle 标题按 env 的 EMAIL_DAYS 动态命名（与拉取区间一致）
    const days = parseInt(process.env.EMAIL_DAYS || '7', 10);
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (Number.isFinite(days) ? days : 7));
    summary.summaryTitle =
      days <= 1
        ? `邮件摘要 ${formatDateYmd(end)}`
        : `邮件摘要 ${formatDateYmd(start)} ~ ${formatDateYmd(end)}`;

    for (const card of summary.actionCards || []) {
      const nextState = card.action_required ? 'new' : 'snoozed';
      upsertThreadState(
        card.thread_key,
        nextState,
        { subject: card.title, from: card.from, date: card.date },
        runId
      );
      insertAction(card, runId);
    }

    const idemKey = createDigestIdempotencyKey(summary);
    const isNewWrite = markNotionWriteIfNew(idemKey, runId);
    console.log(`有效邮件数: ${summary.validCount}，标题: ${summary.summaryTitle}`);
    if (isNewWrite) {
      await appendSummaryToNotion(summary);
      recordNotionWrite(idemKey, runId);
      console.log('已更新 Notion 页面。');
    } else {
      console.log('跳过 Notion 写入（命中幂等键，避免重复追加）。');
    }

    enqueueEscalationReminders(runId, summary.actionCards || []);
    await processReminderQueue();
    finishRun(runId, 'success');
  } catch (err) {
    finishRun(runId, 'failed', err?.message || String(err));
    throw err;
  } finally {
    releaseRunLock(runId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
