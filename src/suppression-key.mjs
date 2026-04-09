function asString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function readRichText(properties, name) {
  return asString((properties?.[name]?.rich_text || []).map((item) => item?.plain_text || '').join(' '));
}

export function buildSuppressionKeyFromActionCard(card) {
  const url = asString(card?.url);
  if (url) return `url:${url}`;

  const title = asString(card?.title).toLowerCase();
  const from = asString(card?.from).toLowerCase();
  if (title || from) return `title:${title}|from:${from}`;

  const threadKey = asString(card?.thread_key);
  return threadKey ? `thread:${threadKey}` : '';
}

export function buildSuppressionKeyFromNotionPage(page) {
  const properties = page?.properties || {};
  const emailProp = properties['邮件'];
  const senderProp = properties['发件人'];
  const explicitSuppressionKey = readRichText(properties, '抑制键');
  if (explicitSuppressionKey) return explicitSuppressionKey;

  const titleItems = emailProp?.title || [];
  const title = asString(titleItems.map((item) => item?.plain_text || '').join(' '));
  const href = asString(titleItems.find((item) => item?.href)?.href);
  if (href) return `url:${href}`;

  const sender = readRichText({ 发件人: senderProp }, '发件人').toLowerCase();
  if (title || sender) return `title:${title.toLowerCase()}|from:${sender}`;

  return '';
}
