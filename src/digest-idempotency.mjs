import crypto from 'node:crypto';

export function createDigestIdempotencyKey(summary) {
  const payload = {
    title: summary?.summaryTitle || '',
    validCount: Number(summary?.validCount || 0),
    cards: (summary?.actionCards || []).map((c) => ({
      thread_key: c.thread_key,
      bucket: c.bucket,
      state: c.state,
      due_by: c.due_by,
      confidence: c.confidence,
    })),
  };
  const json = JSON.stringify(payload);
  return crypto.createHash('sha256').update(json).digest('hex');
}

