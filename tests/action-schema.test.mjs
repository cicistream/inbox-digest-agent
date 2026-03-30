import { describe, expect, it } from 'vitest';
import { validateActionCard } from '../src/action-schema.mjs';

describe('action-schema', () => {
  it('accepts a valid action card', () => {
    const result = validateActionCard({
      thread_key: 'id:1',
      title: 'Interview invite',
      bucket: 'do_now',
      priority: 'high',
      confidence: 'high',
      state: 'new',
      action_required: true,
      evidence: ['contains interview keyword'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid bucket/state', () => {
    const result = validateActionCard({
      thread_key: 'id:1',
      title: 'x',
      bucket: 'urgent',
      priority: 'high',
      confidence: 'high',
      state: 'pending',
      evidence: ['x'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('invalid bucket');
    expect(result.errors.join(' ')).toContain('invalid state');
  });
});

