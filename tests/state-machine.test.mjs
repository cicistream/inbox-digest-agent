import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition } from '../src/state-machine.mjs';

describe('state-machine', () => {
  it('allows valid transitions', () => {
    expect(canTransition('new', 'ack')).toBe(true);
    expect(canTransition('ack', 'done')).toBe(true);
    expect(canTransition('snoozed', 'ack')).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(canTransition('done', 'ack')).toBe(false);
    expect(() => assertTransition('done', 'ack')).toThrow('invalid state transition');
  });
});

