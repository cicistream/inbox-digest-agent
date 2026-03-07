/**
 * 通过 IMAP 拉取邮件（当未配置 Gmail OAuth 时使用，支持任意邮箱）
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';

dotenv.config();

const IMAP_USER = (process.env.IMAP_USER || '').trim();
const IMAP_PASSWORD = (process.env.IMAP_PASSWORD || '').trim();
const IMAP_HOST = (process.env.IMAP_HOST || 'outlook.office365.com').trim();
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);
const EMAIL_DAYS = parseInt(process.env.EMAIL_DAYS || '7', 10);
const EMAIL_ALLOW_SENDERS = process.env.EMAIL_ALLOW_SENDERS
  ? process.env.EMAIL_ALLOW_SENDERS.split(',').map((s) => s.trim().toLowerCase())
  : null;

export function isImapConfigured() {
  return !!(IMAP_USER && IMAP_PASSWORD);
}

/**
 * @returns {Promise<Array<{ id, from, to, subject, date, bodyPlain, snippet }>>}
 */
export async function fetchEmailsFromImap() {
  if (!isImapConfigured()) {
    throw new Error('Missing IMAP_USER or IMAP_PASSWORD in .env');
  }

  const since = new Date();
  since.setDate(since.getDate() - EMAIL_DAYS);

  const isConnectionError = (err) =>
    err?.code === 'ECONNRESET' || /socket disconnected|TLS connection/i.test(err?.message || '');

  const doConnect = (port = IMAP_PORT, secure = true, host = IMAP_HOST) => {
    const client = new ImapFlow({
      host,
      port,
      secure,
      servername: host,
      tls: {
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
        rejectUnauthorized: true,
      },
      auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
      logger: false,
    });
    return client.connect().then(() => client);
  };

  const throwFriendly = (err) => {
    if (err.authenticationFailed || (err.responseText && /auth/i.test(err.responseText))) {
      const hint =
        IMAP_HOST?.includes('outlook') || IMAP_HOST?.includes('office365')
          ? '\n  请确认：① IMAP_USER 为完整邮箱（如 xxx@outlook.com）② IMAP_PASSWORD 为应用密码且 .env 中无多余空格/引号 ③ 网页版 Outlook → 设置 → 同步电子邮件 → 已开启 IMAP。@outlook.com 可尝试 IMAP_HOST=imap-mail.outlook.com'
          : '\n  若邮箱开启了两步验证，请使用应用专用密码填入 IMAP_PASSWORD。';
      throw new Error('IMAP 登录失败（账号或密码被拒绝）。' + hint + '\n原始错误: ' + (err.responseText || err.message));
    }
    if (isConnectionError(err)) {
      throw new Error(
        'IMAP 连接被中断（网络不稳定或防火墙/代理限制）。请稍后重试，或检查本机网络、VPN、公司防火墙是否允许访问 ' +
        IMAP_HOST +
        ':' +
        IMAP_PORT +
        ' 。可尝试在 .env 中设置 IMAP_PORT=143 使用 STARTTLS。\n原始错误: ' +
        err.message
      );
    }
    throw err;
  };

  let client;
  const maxTries = 3;
  for (let tryNum = 1; tryNum <= maxTries; tryNum++) {
    try {
      client = await doConnect(IMAP_PORT, true);
      break;
    } catch (err) {
      if (tryNum < maxTries && isConnectionError(err)) {
        console.log(`IMAP TLS 连接中断，2 秒后重试 (${tryNum}/${maxTries})…`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (IMAP_PORT === 993 && (IMAP_HOST?.includes('outlook') || IMAP_HOST?.includes('office365'))) {
        console.log('993 端口 TLS 失败，尝试 143 端口 STARTTLS…');
        try {
          client = await doConnect(143, false);
          break;
        } catch (e2) {
          if (
            (e2.authenticationFailed || /auth/i.test(e2.responseText || '')) &&
            IMAP_HOST?.includes('office365') &&
            IMAP_USER?.includes('@outlook.com')
          ) {
            console.log('当前主机认证失败，尝试 imap-mail.outlook.com…');
            try {
              client = await doConnect(143, false, 'imap-mail.outlook.com');
              break;
            } catch (e3) {
              throwFriendly(e2);
            }
          }
          throwFriendly(e2);
        }
      }
      throwFriendly(err);
    }
  }

  if (!client) throw new Error('IMAP 连接失败');

  console.log('IMAP 登录成功');
  const results = [];

  try {
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ since }, { uid: true });
    const list = Array.from(uids).slice(-100);

    for (const uid of list) {
      const msg = await client.fetchOne(uid, { source: true });
      if (!msg?.source) continue;

      const parsed = await simpleParser(msg.source);
      const from = parsed.from?.text || '';
      const to = parsed.to?.text || '';
      const subject = parsed.subject || '';
      const date = parsed.date ? parsed.date.toISOString() : '';

      if (EMAIL_ALLOW_SENDERS?.length) {
        const fromLower = from.toLowerCase();
        const allowed = EMAIL_ALLOW_SENDERS.some((s) => fromLower.includes(s));
        if (!allowed) continue;
      }

      const bodyPlain = parsed.text || parsed.textAsHtml?.replace(/<[^>]+>/g, '') || '';
      const snippet = bodyPlain.slice(0, 200);

      results.push({
        id: String(uid),
        from,
        to,
        subject,
        date,
        bodyPlain: bodyPlain || snippet,
        snippet,
      });
    }
  } finally {
    await client.logout();
  }

  return results;
}
