import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

async function loadDbModule(tmpDir) {
  process.env.AGENT_DB_DIR = tmpDir;
  process.env.AGENT_DB_FILE = 'test.sqlite';
  vi.resetModules();
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

  it('prunes suppressions older than retention window', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-db-'));
    const db = await loadDbModule(tmp);
    db.upsertSuppression('old-key', 'watch', 'old');
    db.upsertSuppression('fresh-key', 'watch', 'fresh');

    const sqlite = (await import('better-sqlite3')).default;
    const raw = new sqlite(path.join(tmp, 'test.sqlite'));
    raw
      .prepare(`UPDATE suppressions SET created_at = ? WHERE suppression_key = ?`)
      .run(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(), 'old-key');
    raw.close();

    const deleted = db.pruneOldSuppressions(30);
    expect(deleted).toBe(1);
    expect([...db.listSuppressionKeys()].sort()).toEqual(['fresh-key']);
  });
});
