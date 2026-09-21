/**
 * PII scrubber for contract fixtures (remediation R-18 / Step 6.4).
 *
 * ANY recorder that captures live HTTP responses MUST pipe the body through
 * `anonymize()` before writing a fixture into this repo. Fixtures are
 * committed; real employee emails and names must never be.
 *
 * Rules (deterministic, order independent):
 *  - every distinct email becomes `user-N@example.test`; N is assigned in
 *    first-seen order AFTER sorting the distinct emails by value, so the same
 *    input set always yields the same output;
 *  - values under person-name keys become neutral placeholders;
 *  - already-anonymised emails (`user-N@example.test`) are left untouched.
 *
 * CLI: npx ts-node test/contracts/anonymize.ts <file.json>...   (rewrites in place)
 */
import * as fs from 'node:fs';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const ANON_RE = /^user-(\d+)@example\.test$/;

const NAME_KEYS: Record<string, string> = {
  firstName: 'First',
  lastName: 'Last',
  fullName: 'First Last',
  userName: 'user',
  actorName: 'First Last',
  company: "Company",
};

export function collectEmails(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    for (const m of value.match(EMAIL_RE) ?? []) into.add(m);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectEmails(v, into));
  } else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) => collectEmails(v, into));
  }
  return into;
}

export function buildEmailMap(emails: Iterable<string>): Map<string, string> {
  const distinct = [...new Set(emails)].sort();
  const map = new Map<string, string>();
  const used = new Set<number>();
  for (const e of distinct) {
    const m = ANON_RE.exec(e);
    if (m) {
      map.set(e, e);
      used.add(Number(m[1]));
    }
  }
  let n = 1;
  for (const e of distinct) {
    if (map.has(e)) continue;
    while (used.has(n)) n++;
    used.add(n);
    map.set(e, `user-${n}@example.test`);
  }
  return map;
}

export function anonymize<T>(value: T): T {
  const map = buildEmailMap(collectEmails(value));
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      if (key && key in NAME_KEYS && v !== '') return NAME_KEYS[key];
      return v.replace(EMAIL_RE, (e) => map.get(e) ?? e);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return walk(value) as T;
}

if (require.main === module) {
  for (const file of process.argv.slice(2)) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify(anonymize(json), null, 2)}\n`);
  }
}
