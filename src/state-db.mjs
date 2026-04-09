import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { assertTransition } from './state-machine.mjs';

const DB_DIR = process.env.AGENT_DB_DIR || '.data';
const DB_FILE = process.env.AGENT_DB_FILE || 'agent-state.sqlite';
const LOCK_NAME = process.env.AGENT_LOCK_NAME || 'digest-main';
const STALE_LOCK_SECONDS = parseInt(process.env.AGENT_STALE_LOCK_SECONDS || '1800', 10);
const SUPPRESSION_RETENTION_DAYS = parseInt(process.env.SUPPRESSION_RETENTION_DAYS || '30', 10);

let db;

function nowIso() {
  return new Date().toISOString();
}

function ensureDb() {
  if (db) return db;
  const dir = path.resolve(DB_DIR);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, DB_FILE));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS locks (
      name TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      thread_key TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      last_subject TEXT,
      last_from TEXT,
      last_date TEXT,
      last_updated_at TEXT NOT NULL,
      last_run_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      thread_key TEXT NOT NULL,
      message_id TEXT,
      title TEXT NOT NULL,
      bucket TEXT NOT NULL,
      action_required INTEGER NOT NULL,
      due_by TEXT,
      priority TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL,
      state TEXT NOT NULL,
      url TEXT,
      sender TEXT,
      received_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retry_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      retries INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS notion_writes (
      idempotency_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppressions (
      suppression_key TEXT PRIMARY KEY,
      source_bucket TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  try {
    db.prepare(`ALTER TABLE retry_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`).run();
  } catch {}
  try {
    db.prepare(`ALTER TABLE retry_queue ADD COLUMN created_at TEXT`).run();
  } catch {}
  return db;
}

export function startRun(runId) {
  const x = ensureDb();
  x.prepare(
    `INSERT INTO runs (run_id, started_at, status) VALUES (?, ?, ?)`
  ).run(runId, nowIso(), 'running');
}

export function finishRun(runId, status, error = null) {
  const x = ensureDb();
  x.prepare(
    `UPDATE runs SET ended_at = ?, status = ?, error = ? WHERE run_id = ?`
  ).run(nowIso(), status, error, runId);
}

export function acquireRunLock(runId) {
  const x = ensureDb();
  const row = x.prepare(`SELECT run_id, acquired_at FROM locks WHERE name = ?`).get(LOCK_NAME);
  if (row) {
    const age = Date.now() - new Date(row.acquired_at).getTime();
    if (Number.isFinite(age) && age / 1000 > STALE_LOCK_SECONDS) {
      x.prepare(`DELETE FROM locks WHERE name = ?`).run(LOCK_NAME);
    } else {
      throw new Error(`another run is active (run_id=${row.run_id})`);
    }
  }
  x.prepare(`INSERT INTO locks (name, run_id, acquired_at) VALUES (?, ?, ?)`).run(LOCK_NAME, runId, nowIso());
}

export function releaseRunLock(runId) {
  const x = ensureDb();
  x.prepare(`DELETE FROM locks WHERE name = ? AND run_id = ?`).run(LOCK_NAME, runId);
}

export function upsertThreadState(threadKey, toState, meta, runId) {
  const x = ensureDb();
  const existing = x.prepare(`SELECT state FROM threads WHERE thread_key = ?`).get(threadKey);
  const fromState = existing?.state || 'new';
  assertTransition(fromState, toState);
  x.prepare(
    `INSERT INTO threads (thread_key, state, last_subject, last_from, last_date, last_updated_at, last_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_key) DO UPDATE SET
       state=excluded.state,
       last_subject=excluded.last_subject,
       last_from=excluded.last_from,
       last_date=excluded.last_date,
       last_updated_at=excluded.last_updated_at,
       last_run_id=excluded.last_run_id`
  ).run(
    threadKey,
    toState,
    meta?.subject || '',
    meta?.from || '',
    meta?.date || '',
    nowIso(),
    runId
  );
}

export function insertAction(card, runId) {
  const x = ensureDb();
  x.prepare(
    `INSERT INTO actions
      (run_id, thread_key, message_id, title, bucket, action_required, due_by, priority, evidence_json, source, confidence, state, url, sender, received_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    card.thread_key,
    card.message_id || '',
    card.title,
    card.bucket,
    card.action_required ? 1 : 0,
    card.due_by,
    card.priority,
    JSON.stringify(card.evidence || []),
    card.source || 'rule',
    card.confidence || 'medium',
    card.state || 'new',
    card.url || '',
    card.from || '',
    card.date || '',
    nowIso()
  );
}

export function markNotionWriteIfNew(idempotencyKey, runId) {
  const x = ensureDb();
  const row = x.prepare(`SELECT idempotency_key FROM notion_writes WHERE idempotency_key = ?`).get(idempotencyKey);
  if (row) return false;
  return true;
}

export function recordNotionWrite(idempotencyKey, runId) {
  const x = ensureDb();
  x.prepare(
    `INSERT OR IGNORE INTO notion_writes (idempotency_key, run_id, created_at) VALUES (?, ?, ?)`
  ).run(idempotencyKey, runId, nowIso());
}

export function upsertSuppression(suppressionKey, sourceBucket, reason) {
  if (!suppressionKey) return;
  const x = ensureDb();
  x.prepare(
    `INSERT INTO suppressions (suppression_key, source_bucket, reason, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(suppression_key) DO UPDATE SET
       source_bucket=excluded.source_bucket,
       reason=excluded.reason,
       created_at=excluded.created_at`
  ).run(suppressionKey, sourceBucket, reason, nowIso());
}

export function listSuppressionKeys() {
  const x = ensureDb();
  const rows = x.prepare(`SELECT suppression_key FROM suppressions`).all();
  return new Set(rows.map((row) => row.suppression_key).filter(Boolean));
}

export function pruneOldSuppressions(retentionDays = SUPPRESSION_RETENTION_DAYS) {
  const x = ensureDb();
  const days = Number.isFinite(retentionDays) ? retentionDays : SUPPRESSION_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = x.prepare(`DELETE FROM suppressions WHERE created_at < ?`).run(cutoff);
  return result.changes || 0;
}

export function enqueueReminder(runId, channel, payload, nextRetryAt = nowIso()) {
  const x = ensureDb();
  x.prepare(
    `INSERT INTO retry_queue (run_id, channel, payload_json, retries, next_retry_at, last_error, status, created_at)
     VALUES (?, ?, ?, 0, ?, NULL, 'pending', ?)`
  ).run(runId, channel, JSON.stringify(payload), nextRetryAt, nowIso());
}

export function fetchDueRetries(limit = 50) {
  const x = ensureDb();
  return x.prepare(
    `SELECT id, run_id, channel, payload_json, retries, next_retry_at
     FROM retry_queue
     WHERE status = 'pending' AND next_retry_at <= ?
     ORDER BY id ASC LIMIT ?`
  ).all(nowIso(), limit);
}

export function markRetrySuccess(id) {
  const x = ensureDb();
  x.prepare(`UPDATE retry_queue SET status = 'done', last_error = NULL WHERE id = ?`).run(id);
}

export function markRetryFailure(id, retries, err, backoffSeconds = 300) {
  const x = ensureDb();
  const next = new Date(Date.now() + backoffSeconds * 1000).toISOString();
  x.prepare(
    `UPDATE retry_queue
     SET status = CASE WHEN ? >= 3 THEN 'failed' ELSE 'pending' END,
         retries = ?,
         last_error = ?,
         next_retry_at = ?
     WHERE id = ?`
  ).run(retries, retries, String(err || ''), next, id);
}

export function listThreadQueue(limit = 100) {
  const x = ensureDb();
  return x.prepare(
    `SELECT
      t.thread_key,
      t.state,
      t.last_subject,
      t.last_from,
      t.last_date,
      a.bucket,
      a.priority,
      a.confidence,
      a.url
     FROM threads t
     LEFT JOIN actions a
       ON a.id = (
         SELECT a2.id
         FROM actions a2
         WHERE a2.thread_key = t.thread_key
         ORDER BY a2.id DESC
         LIMIT 1
       )
     ORDER BY
       CASE a.bucket WHEN 'do_now' THEN 1 WHEN 'this_week' THEN 2 ELSE 3 END,
       t.last_updated_at DESC
     LIMIT ?`
  ).all(limit);
}

export function updateThreadState(threadKey, toState, runId = 'manual') {
  const x = ensureDb();
  const row = x.prepare(
    `SELECT state, last_subject, last_from, last_date FROM threads WHERE thread_key = ?`
  ).get(threadKey);
  if (!row) {
    throw new Error(`thread not found: ${threadKey}`);
  }
  assertTransition(row.state, toState);
  x.prepare(
    `UPDATE threads
     SET state = ?, last_updated_at = ?, last_run_id = ?
     WHERE thread_key = ?`
  ).run(toState, nowIso(), runId, threadKey);
}
