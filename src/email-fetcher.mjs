/**
 * 从 Gmail 拉取邮件并做基础过滤（未读/最近 N 天/发件人白名单等）
 * 需配置 Gmail OAuth2 或 IMAP（见 .env.example）
 */
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const GMAIL_USER = process.env.GMAIL_USER || 'me';
const EMAIL_DAYS = parseInt(process.env.EMAIL_DAYS || '7', 10);
const EMAIL_ALLOW_SENDERS = process.env.EMAIL_ALLOW_SENDERS
  ? process.env.EMAIL_ALLOW_SENDERS.split(',').map((s) => s.trim().toLowerCase())
  : null;

function getOAuth2Client() {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error(
      'Missing Gmail OAuth2 env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN'
    );
  }
  const oauth2 = new google.auth.OAuth2(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  oauth2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return oauth2;
}

function decodeBody(payload) {
  if (!payload) return '';
  const parts = payload.parts || [];
  if (parts.length) {
    const textPart =
      parts.find((p) => p.mimeType === 'text/plain') ||
      parts.find((p) => p.mimeType === 'text/html');
    if (textPart?.body?.data) {
      return Buffer.from(
        textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf-8');
    }
  }
  if (payload.body?.data) {
    return Buffer.from(
      payload.body.data.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf-8');
  }
  return '';
}

function getHeader(headers, name) {
  const h = headers?.find((x) => x.name?.toLowerCase() === name?.toLowerCase());
  return h?.value || '';
}

/**
 * 拉取最近 N 天的邮件（使用 Gmail API）
 * @returns {Promise<Array<{ id, from, to, subject, date, bodyPlain, snippet }>>}
 */
export async function fetchEmailsFromGmail() {
  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  const after = new Date();
  after.setDate(after.getDate() - EMAIL_DAYS);
  const q = [
    `after:${Math.floor(after.getTime() / 1000)}`,
    'is:inbox',
    '-is:spam',
    '-is:trash',
  ].join(' ');

  const listRes = await gmail.users.messages.list({
    userId: GMAIL_USER,
    q,
    maxResults: 100,
  });

  const messages = listRes.data.messages || [];
  const results = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: GMAIL_USER,
      id: msg.id,
      format: 'full',
    });
    const payload = full.data.payload;
    const headers = payload?.headers || [];
    const from = getHeader(headers, 'From');
    const to = getHeader(headers, 'To');
    const subject = getHeader(headers, 'Subject');
    const date = getHeader(headers, 'Date');

    if (EMAIL_ALLOW_SENDERS?.length) {
      const fromLower = from.toLowerCase();
      const allowed = EMAIL_ALLOW_SENDERS.some(
        (s) => fromLower.includes(s) || fromLower.includes(s.replace(/\s/g, ''))
      );
      if (!allowed) continue;
    }

    const bodyPlain = decodeBody(payload);
    const snippet = full.data.snippet || '';

    results.push({
      id: msg.id,
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

/**
 * 检查是否已配置 Gmail（用于选择 fetcher）
 */
export function isGmailConfigured() {
  return !!(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN);
}
