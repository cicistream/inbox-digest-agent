/**
 * 通过 Microsoft Graph API + OAuth2 拉取 Outlook 邮件（无需 IMAP 应用密码）
 */
import { getAccessToken } from './outlook-oauth.mjs';

const GRAPH_MESSAGES =
  'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages';
const EMAIL_DAYS = parseInt(process.env.EMAIL_DAYS || '7', 10);
const EMAIL_ALLOW_SENDERS = process.env.EMAIL_ALLOW_SENDERS
  ? process.env.EMAIL_ALLOW_SENDERS.split(',').map((s) => s.trim().toLowerCase())
  : null;

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isOutlookOAuthConfigured() {
  const id = (process.env.OUTLOOK_CLIENT_ID || '').trim();
  const ref = (process.env.OUTLOOK_REFRESH_TOKEN || '').trim();
  return !!(id && ref);
}

/**
 * @returns {Promise<Array<{ id, webLink?: string, from, to, subject, date, bodyPlain, snippet }>>}
 */
export async function fetchEmailsFromOutlookGraph() {
  const clientId = (process.env.OUTLOOK_CLIENT_ID || '').trim();
  const clientSecret = (process.env.OUTLOOK_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.OUTLOOK_REFRESH_TOKEN || '').trim();
  if (!clientId || !refreshToken) {
    throw new Error('请配置 OUTLOOK_CLIENT_ID 和 OUTLOOK_REFRESH_TOKEN（运行 pnpm run outlook:auth 获取）');
  }

  const accessToken = await getAccessToken({
    clientId,
    clientSecret: clientSecret || undefined,
    refreshToken,
  });

  const since = new Date();
  since.setDate(since.getDate() - EMAIL_DAYS);
  const sinceStr = since.toISOString();
  const filter = `receivedDateTime ge ${sinceStr}`;

  const url = `${GRAPH_MESSAGES}?$top=100&$select=id,webLink,from,toRecipients,subject,receivedDateTime,bodyPreview,body&$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime desc`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API 请求失败: ${res.status} ${err}`);
  }
  const data = await res.json();
  const messages = data.value || [];
  const results = [];

  for (const msg of messages) {
    const from = msg.from?.emailAddress?.address || msg.from?.emailAddress?.name || '';
    const to = (msg.toRecipients || []).map((r) => r.emailAddress?.address || '').filter(Boolean).join(', ');
    const subject = msg.subject || '';
    const date = msg.receivedDateTime || '';
    const bodyPreview = msg.bodyPreview || '';
    const bodyContent = msg.body?.content != null ? stripHtml(msg.body.content) : '';
    const bodyPlain = bodyContent || bodyPreview;
    const snippet = bodyPlain.slice(0, 500);

    if (EMAIL_ALLOW_SENDERS?.length) {
      const fromLower = from.toLowerCase();
      if (!EMAIL_ALLOW_SENDERS.some((s) => fromLower.includes(s))) continue;
    }

    results.push({
      id: msg.id,
      webLink: msg.webLink,
      from,
      to,
      subject,
      date,
      bodyPlain: bodyPlain || snippet,
      snippet,
    });
  }

  return results;
}
