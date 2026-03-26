import { describe, expect, it } from 'vitest';
import { bandByScore, bucketByRule, evaluateEmailRule } from '../src/rule-engine.mjs';

describe('rule-engine', () => {
  it('detects high-signal interview mail as do_now/this_week', () => {
    const rule = evaluateEmailRule({
      from: 'recruiter@acme.com',
      subject: 'Interview schedule confirmation',
      bodyPlain: 'Please confirm your availability tomorrow.',
    });
    expect(rule.score).toBeGreaterThanOrEqual(4);
    expect(['do_now', 'this_week']).toContain(bucketByRule(rule));
  });

  it('classifies obvious newsletter as low band', () => {
    const rule = evaluateEmailRule({
      from: 'news@promo.com',
      subject: 'Weekly newsletter - unsubscribe anytime',
      bodyPlain: 'promotion and advertisement',
    });
    expect(bandByScore(rule.score)).toBe('low');
    expect(bucketByRule(rule)).toBe('watch');
  });
});

