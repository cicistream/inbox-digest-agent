/**
 * Rule-first action digest with optional LLM fallback for mid-confidence cases.
 */
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { bandByScore, bucketByRule, evaluateEmailRule } from './rule-engine.mjs';
import { normalizeActionCard, validateActionCard } from './action-schema.mjs';
import { buildSuppressionKeyFromActionCard } from './suppression-key.mjs';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

function formatDateYmd(d) {
  return d.toISOString().slice(0, 10);
}

function toThreadKey(email) {
  const id = (email?.id || '').trim();
  if (id) return `id:${id}`;
  const from = (email?.from || '').trim().toLowerCase();
  const subject = (email?.subject || '').trim().toLowerCase();
  return `fallback:${from}|${subject}`;
}

async function llmClassify(email, rule) {
  const prompt = `你是一个求职邮件分拣器。请输出 JSON：
{
  "action_required": boolean,
  "bucket": "do_now|this_week|watch",
  "priority": "high|medium|low",
  "confidence": "high|medium|low",
  "why_flagged": "一句话",
  "summary": "一句话下一步"
}
输入邮件：
发件人: ${email.from}
主题: ${email.subject}
日期: ${email.date}
正文摘要: ${(email.bodyPlain || email.snippet || '').slice(0, 1200)}
当前规则证据: ${rule.evidence.join('; ')}`;

  const completion = await openai.chat.completions.create({
    model: process.env.MODEL_NAME || 'qwen-turbo',
    messages: [
      { role: 'system', content: '只输出 JSON，不要 markdown。' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '{}';
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(jsonStr);
}

function bucketLabel(bucket) {
  if (bucket === 'do_now') return '立即处理';
  if (bucket === 'this_week') return '本周跟进';
  return '持续关注';
}

function priorityLabel(p) {
  if (p === 'high') return '高';
  if (p === 'medium') return '中';
  if (p === 'low') return '低';
  return String(p || '—');
}

function confidenceLabel(c) {
  if (c === 'high') return '高';
  if (c === 'medium') return '中';
  if (c === 'low') return '低';
  return String(c || '—');
}

function buildNotionSections(cards) {
  const order = ['do_now', 'this_week', 'watch'];
  const out = [];
  for (const b of order) {
    const items = cards.filter((x) => x.bucket === b);
    if (!items.length) continue;
    out.push({
      sourceIndex: undefined,
      kind: 'bucket',
      title: `${bucketLabel(b)}（${items.length} 封）`,
    });
    for (const item of items) {
      const dueLine = item.due_by ? `截止：${item.due_by}` : '截止：未在邮件中标明';
      const evidence = (item.evidence || []).filter(Boolean).join('；');
      out.push({
        sourceIndex: undefined,
        kind: 'item',
        title: item.title,
        bullets: [
          item.summary ? `下一步：${item.summary}` : '下一步：请打开原邮件确认具体动作',
          item.action_required ? '状态：需要处理' : '状态：仅观察',
          dueLine,
          `优先级：${priorityLabel(item.priority)}`,
          `置信度：${confidenceLabel(item.confidence)}`,
          evidence ? `依据：${evidence}` : '依据：（规则/模型未给出额外说明）',
        ],
        url: item.url,
        from: item.from,
        date: item.date,
      });
    }
  }
  return out;
}

export async function buildActionDigest(emails, options = {}) {
  const suppressedKeys = options?.suppressedKeys instanceof Set ? options.suppressedKeys : new Set();
  if (!emails?.length) {
    return {
      validCount: 0,
      summaryTitle: '邮件摘要（无新邮件）',
      summarySections: [],
      actionCards: [],
    };
  }

  const cards = [];
  for (const email of emails.slice(0, 100)) {
    const rule = evaluateEmailRule(email);
    const band = bandByScore(rule.score);
    let bucket = bucketByRule(rule);
    let source = 'rule';
    let confidence = band === 'high' ? 'high' : band === 'low' ? 'medium' : 'low';
    let summary = '';
    let actionRequired = bucket !== 'watch';
    let extraEvidence = [];
    let priority = bucket === 'do_now' ? 'high' : bucket === 'this_week' ? 'medium' : 'low';

    if (band === 'mid' && process.env.OPENAI_API_KEY) {
      try {
        const llm = await llmClassify(email, rule);
        if (['do_now', 'this_week', 'watch'].includes(llm.bucket)) bucket = llm.bucket;
        if (['high', 'medium', 'low'].includes(llm.priority)) priority = llm.priority;
        if (['high', 'medium', 'low'].includes(llm.confidence)) confidence = llm.confidence;
        summary = typeof llm.summary === 'string' ? llm.summary : '';
        actionRequired = Boolean(llm.action_required);
        source = 'llm';
        if (llm.why_flagged) extraEvidence.push(String(llm.why_flagged));
      } catch {
        extraEvidence.push('llm fallback failed, kept rule decision');
      }
    }

    const candidate = normalizeActionCard({
      thread_key: toThreadKey(email),
      message_id: email.id || '',
      company: rule.company,
      role: '',
      action_required: actionRequired,
      due_by: rule.dueBy,
      priority,
      bucket,
      evidence: [...rule.evidence, ...extraEvidence],
      source,
      confidence,
      state: 'new',
      title: email.subject || '（无主题）',
      summary,
      url: email.webLink || '',
      from: email.from || '',
      date: email.date || '',
    });

    const check = validateActionCard(candidate);
    if (!check.ok) {
      continue;
    }
    const suppressionKey = buildSuppressionKeyFromActionCard(check.card);
    if (suppressionKey && suppressedKeys.has(suppressionKey)) {
      continue;
    }
    cards.push(check.card);
  }

  const end = new Date();
  const days = parseInt(process.env.EMAIL_DAYS || '7', 10);
  const start = new Date(end);
  start.setDate(start.getDate() - (Number.isFinite(days) ? days : 7));
  const title =
    days <= 1
      ? `邮件摘要 ${formatDateYmd(end)}`
      : `邮件摘要 ${formatDateYmd(start)} ~ ${formatDateYmd(end)}`;

  return {
    validCount: cards.length,
    summaryTitle: title,
    summarySections: buildNotionSections(cards),
    actionCards: cards,
  };
}

/**
 * Backward-compatible entry.
 */
export async function filterAndSummarize(emails) {
  return buildActionDigest(emails);
}
