import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function loadDbModule(tmpDir) {
  process.env.AGENT_DB_DIR = tmpDir;
  process.env.AGENT_DB_FILE = 'test.sqlite';
  const m = await import('../src/state-db.mjs');
  return m;
}

describe('state-db', () => {
  it('supports upsert/list/update state flow', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-db-'));
    const db = await loadDbModule(tmp);
    db.startRun('run-1');
    db.upsertThreadState('id:1', 'new', { subject: 'Interview', from: 'a@b.com', date: '2026-03-26' }, 'run-1');
    db.insertAction({
      thread_key: 'id:1',
      title: 'Interview',
      bucket: 'do_now',
      action_required: true,
      due_by: null,
      priority: 'high',
      evidence: ['test'],
      source: 'rule',
      confidence: 'high',
      state: 'new',
      url: '',
      from: 'a@b.com',
      date: '2026-03-26',
    }, 'run-1');

    const rows = db.listThreadQueue(10);
    expect(rows.length).toBe(1);
    expect(rows[0].thread_key).toBe('id:1');
    expect(rows[0].state).toBe('new');

    db.updateThreadState('id:1', 'ack', 'manual');
    const rows2 = db.listThreadQueue(10);
    expect(rows2[0].state).toBe('ack');
  });
});
