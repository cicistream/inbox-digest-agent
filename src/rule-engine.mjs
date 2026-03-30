import rules from './rules.json' with { type: 'json' };

function containsAny(text, words) {
  return words.some((w) => text.includes(w));
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

function extractDueBy(text) {
  const m = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (m) return m[1];
  return null;
}

function extractCompany(from = '') {
  const d = String(from).match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (!d) return 'Unknown';
  const part = d[1].split('.')[0] || 'Unknown';
  return part.charAt(0).toUpperCase() + part.slice(1);
}

export function evaluateEmailRule(email) {
  const text = normalize(`${email?.subject || ''}\n${email?.bodyPlain || email?.snippet || ''}\n${email?.from || ''}`);
  const evidence = [];
  let score = 0;

  if (containsAny(text, rules.highSignalKeywords)) {
    score += 3;
    evidence.push('contains high-signal keyword');
  }
  if (containsAny(text, rules.mediumSignalKeywords)) {
    score += 1;
    evidence.push('contains medium-signal keyword');
  }
  if (containsAny(text, rules.negativeKeywords)) {
    score -= 3;
    evidence.push('contains negative/noise keyword');
  }
  if (containsAny(text, rules.dueSoonKeywords)) {
    score += 2;
    evidence.push('contains due-soon wording');
  }

  const dueBy = extractDueBy(text);
  if (dueBy) evidence.push(`due date detected: ${dueBy}`);

  const rule = {
    score,
    dueBy,
    evidence: evidence.length ? evidence : ['default low-signal fallback'],
    company: extractCompany(email?.from || ''),
  };
  return rule;
}

export function bandByScore(score) {
  if (score >= 4) return 'high';
  if (score <= -1) return 'low';
  return 'mid';
}

export function bucketByRule(rule) {
  const band = bandByScore(rule.score);
  if (band === 'low') return 'watch';
  if (band === 'high') {
    if (rule.dueBy) return 'do_now';
    if (rule.evidence.some((x) => x.includes('due-soon'))) return 'do_now';
    return 'this_week';
  }
  return 'this_week';
}

