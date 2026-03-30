/**
 * Central action-card contract.
 */

export const ACTION_STATES = ['new', 'ack', 'done', 'snoozed'];
export const ACTION_BUCKETS = ['do_now', 'this_week', 'watch'];
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

function asString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence.map((x) => asString(x)).filter(Boolean).slice(0, 6);
}

export function normalizeActionCard(card) {
  const out = {
    version: 1,
    thread_key: asString(card?.thread_key),
    message_id: asString(card?.message_id),
    company: asString(card?.company) || 'Unknown',
    role: asString(card?.role) || '',
    action_required: Boolean(card?.action_required),
    due_by: asString(card?.due_by) || null,
    priority: asString(card?.priority) || 'medium',
    bucket: asString(card?.bucket) || 'watch',
    evidence: normalizeEvidence(card?.evidence),
    source: asString(card?.source) || 'rule',
    confidence: asString(card?.confidence) || 'medium',
    state: asString(card?.state) || 'new',
    title: asString(card?.title) || '（无标题）',
    summary: asString(card?.summary) || '',
    url: asString(card?.url) || '',
    from: asString(card?.from) || '',
    date: asString(card?.date) || '',
  };
  return out;
}

export function validateActionCard(card) {
  const c = normalizeActionCard(card);
  const errors = [];
  if (!c.thread_key) errors.push('thread_key is required');
  if (!ACTION_STATES.includes(c.state)) errors.push(`invalid state: ${c.state}`);
  if (!ACTION_BUCKETS.includes(c.bucket)) errors.push(`invalid bucket: ${c.bucket}`);
  if (!CONFIDENCE_LEVELS.includes(c.confidence)) errors.push(`invalid confidence: ${c.confidence}`);
  if (!['high', 'medium', 'low'].includes(c.priority)) errors.push(`invalid priority: ${c.priority}`);
  if (!c.title) errors.push('title is required');
  if (!Array.isArray(c.evidence) || c.evidence.length === 0) errors.push('evidence must have at least one item');
  return { ok: errors.length === 0, errors, card: c };
}

