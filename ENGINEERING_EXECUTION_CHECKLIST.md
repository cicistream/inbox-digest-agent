# Engineering Execution Checklist (from /plan-eng-review)

Date: 2026-03-24
Branch: main
Scope mode: Phase split (reduced scope, reliability first)

## Goal
Build a lightweight "Job Hunt Action Radar" that minimizes missed action-required emails with measurable quality gates.

## Delivery Strategy
- Phase 1 (Reliability Core): action detection + state tracking + test/eval gates
- Phase 2 (Showcase Layer): escalation reminders + visual output polish

---

## Phase 1 - Reliability Core (must complete first)

### 1) Concurrency and run safety
- [ ] Add DB lock with `run_id` per execution
- [ ] Refuse overlapping runs when lock exists
- [ ] Add stale-lock recovery path
- [ ] Persist run metadata (`started_at`, `ended_at`, `status`, `error`)

### 2) Thread-level state machine
- [ ] Implement thread states: `new`, `ack`, `done`, `snoozed`
- [ ] Store message snapshots under thread
- [ ] Enforce transition rules (reject invalid transitions)
- [ ] Add dedupe key per thread/message

### 3) Action-card contract
- [ ] Define single schema (versioned) for action cards:
  - `company`, `role`, `action_required`, `due_by`, `priority`, `evidence`, `link`, `state`
- [ ] Validate all cards before DB write
- [ ] Reject/repair invalid payloads with explicit error logs

### 4) Rule-first classifier + LLM fallback
- [ ] Move rules into data file (`rules.json` or `rules/*.json`)
- [ ] Build deterministic rule engine (`rule_score`, `why_flagged`)
- [ ] Define score bands:
  - High: direct classify
  - Low: direct ignore/watch
  - Mid: LLM fallback
- [ ] Persist `evidence` and final decision source (`rule` or `llm`)

### 5) Minimal DAO layer (no heavy ORM)
- [ ] Centralize SQL/transactions for:
  - `runs`
  - `threads`
  - `actions`
  - `retry_queue`
- [ ] Keep business logic outside SQL call sites

### 6) Output + idempotency
- [ ] Generate 3 buckets: `Do Now`, `This Week`, `Watch`
- [ ] Add idempotent write key for Notion append
- [ ] Ensure partial failures are visible (no silent success)

### 7) Performance and reliability guards
- [ ] Add rate limiter for LLM calls
- [ ] Add rate limiter for Notion writes
- [ ] Add retry with backoff + jitter
- [ ] Keep reminder path non-blocking for main run

---

## Phase 2 - Showcase Layer

### 8) Escalation reminders
- [ ] Add async reminder worker from `retry_queue`
- [ ] Implement escalation policy (2h and 12h)
- [ ] Ensure reminder failures never fail core digest

### 9) Presentation polish
- [ ] Improve Markdown/HTML digest layout for quick scan
- [ ] Keep section ordering stable and deterministic
- [ ] Add GitHub demo section showing before/after output

---

## Required Test Plan

### Framework setup
- [ ] Add `vitest` configuration and scripts
- [ ] Add test directories for `unit` and `integration`

### Unit tests
- [ ] Rule engine score boundaries
- [ ] Schema validator pass/fail cases
- [ ] State transition matrix
- [ ] Deduping logic
- [ ] Retry/backoff behavior

### Integration tests
- [ ] Run lock behavior (overlap denied)
- [ ] Thread persistence and idempotent updates
- [ ] Notion write retry and failure visibility
- [ ] Reminder queue enqueue/dequeue flow

### Eval tests (mandatory gate)
- [ ] Build anonymized dataset (30-50 samples)
- [ ] Track: `FN`, `FP`, `precision`, `recall`
- [ ] Fail build when FN threshold is exceeded
- [ ] Store baseline and compare each change

---

## Acceptance Gates (Definition of Done)
- [ ] 7-day run trial without duplicate reminders or duplicate writes
- [ ] False negative rate at or below agreed threshold (suggested <= 5%)
- [ ] Every action card includes explicit evidence and next action
- [ ] Failures are user-visible and recoverable (no silent failures)
- [ ] Tests + eval pass in CI before merge

---

## Suggested File Impact (minimal-diff target)
- `src/index.mjs` (orchestration updates)
- `src/summarizer.mjs` (rule-first + fallback boundary)
- `src/notion-client.mjs` (idempotent append + retry integration)
- New: DB/DAO module(s)
- New: rules data file(s)
- New: tests (`unit`, `integration`, `eval`)

Keep total touched files as low as practical by extending existing modules first, then splitting only where ownership boundaries become clear.
