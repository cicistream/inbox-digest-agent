import {
  enqueueReminder,
  fetchDueRetries,
  markRetryFailure,
  markRetrySuccess,
} from './state-db.mjs';
import nodemailer from 'nodemailer';

function listChannels() {
  const raw = process.env.REMINDER_CHANNELS || 'console';
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

async function sendViaChannel(channel, payload) {
  if (channel === 'console') {
    console.log(`[reminder:${channel}] ${payload.title} | ${payload.url || 'no-link'} | ${payload.reason}`);
    return;
  }
  if (channel === 'telegram') {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = process.env.TELEGRAM_CHAT_ID || '';
    if (!token || !chatId) {
      throw new Error('missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    }
    const text = [
      'Job Hunt Action Radar',
      `- ${payload.title || 'Untitled'}`,
      `- ${payload.reason || 'Do Now item pending'}`,
      payload.url ? `- ${payload.url}` : '',
    ].filter(Boolean).join('\n');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`telegram send failed: ${res.status} ${msg}`);
    }
    return;
  }
  if (channel === 'email') {
    const host = process.env.SMTP_HOST || '';
    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASS || '';
    const from = process.env.REMINDER_EMAIL_FROM || user;
    const to = process.env.REMINDER_EMAIL_TO || '';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    if (!host || !user || !pass || !to) {
      throw new Error('missing SMTP_HOST/SMTP_USER/SMTP_PASS/REMINDER_EMAIL_TO');
    }
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({
      from,
      to,
      subject: `[Action Radar] ${payload.title || 'Action required'}`,
      text: `${payload.reason || 'Pending action'}\n${payload.url || ''}`.trim(),
    });
    return;
  }
  throw new Error(`unknown reminder channel: ${channel}`);
}

export function enqueueEscalationReminders(runId, cards) {
  const channels = listChannels();
  const now = new Date().toISOString();
  for (const card of cards || []) {
    if (!card.action_required) continue;
    if (card.bucket !== 'do_now') continue;
    for (const channel of channels) {
      enqueueReminder(runId, channel, {
        thread_key: card.thread_key,
        title: card.title,
        url: card.url,
        reason: 'Do Now item not yet acknowledged',
      }, now);
    }
  }
}

export async function processReminderQueue() {
  const items = fetchDueRetries(50);
  for (const item of items) {
    const retries = Number(item.retries || 0) + 1;
    try {
      const payload = JSON.parse(item.payload_json || '{}');
      await sendViaChannel(item.channel, payload);
      markRetrySuccess(item.id);
    } catch (err) {
      const backoff = Math.min(300 * retries, 3600);
      markRetryFailure(item.id, retries, err?.message || String(err), backoff);
    }
  }
}
