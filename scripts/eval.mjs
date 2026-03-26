import fs from 'node:fs';
import path from 'node:path';
import { evaluateEmailRule } from '../src/rule-engine.mjs';

const file = process.argv[2] || path.resolve('eval/samples.jsonl');
const fnThreshold = Number(process.env.EVAL_FN_MAX || '0.08');

if (!fs.existsSync(file)) {
  console.error(`eval dataset not found: ${file}`);
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
const rows = lines.map((line, i) => {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`invalid jsonl at line ${i + 1}`);
  }
});

let tp = 0;
let tn = 0;
let fp = 0;
let fn = 0;

for (const row of rows) {
  const rule = evaluateEmailRule({
    from: row.from || '',
    subject: row.subject || '',
    bodyPlain: row.body || '',
  });
  const predicted = rule.score >= 1;
  const expected = Boolean(row.expected_action_required);
  if (predicted && expected) tp += 1;
  else if (!predicted && !expected) tn += 1;
  else if (predicted && !expected) fp += 1;
  else fn += 1;
}

const total = rows.length || 1;
const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
const fnRate = fn / total;

console.log(JSON.stringify({
  dataset: file,
  total: rows.length,
  tp,
  tn,
  fp,
  fn,
  precision: Number(precision.toFixed(4)),
  recall: Number(recall.toFixed(4)),
  fn_rate: Number(fnRate.toFixed(4)),
  threshold_fn_max: fnThreshold,
}, null, 2));

if (fnRate > fnThreshold) {
  console.error(`FN gate failed: ${fnRate.toFixed(4)} > ${fnThreshold}`);
  process.exit(2);
}

