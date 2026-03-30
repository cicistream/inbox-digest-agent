import { describe, expect, it } from 'vitest';
import { createDigestIdempotencyKey } from '../src/digest-idempotency.mjs';

describe('digest-idempotency', () => {
  it('creates stable key for same semantic digest', () => {
    const a = createDigestIdempotencyKey({
      summaryTitle: '邮件摘要 2026-03-24',
      validCount: 1,
      actionCards: [{ thread_key: 'id:1', bucket: 'do_now', state: 'new', due_by: null, confidence: 'high' }],
    });
    const b = createDigestIdempotencyKey({
      summaryTitle: '邮件摘要 2026-03-24',
      validCount: 1,
      actionCards: [{ thread_key: 'id:1', bucket: 'do_now', state: 'new', due_by: null, confidence: 'high' }],
    });
    expect(a).toBe(b);
  });

  it('changes key when digest content changes', () => {
    const a = createDigestIdempotencyKey({
      summaryTitle: '邮件摘要 2026-03-24',
      validCount: 1,
      actionCards: [{ thread_key: 'id:1', bucket: 'do_now', state: 'new', due_by: null, confidence: 'high' }],
    });
    const b = createDigestIdempotencyKey({
      summaryTitle: '邮件摘要 2026-03-24',
      validCount: 1,
      actionCards: [{ thread_key: 'id:1', bucket: 'watch', state: 'new', due_by: null, confidence: 'high' }],
    });
    expect(a).not.toBe(b);
  });
});

