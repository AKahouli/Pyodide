import * as fs from 'fs';
import * as path from 'path';

/**
 * F.3 / remediation 4.7: enforceable no-Mongoose gate. Scans all non-spec .ts
 * files under src/ and fails on any Mongoose usage. The allowlist shrank to
 * zero with P5/P10: the application no longer opens a MongoDB connection (the
 * Mongoose-based specs and the one-off backfill scripts are the only users).
 */
const FORBIDDEN = [
  '@InjectModel(',
  '@InjectConnection(',
  'MongooseModule.forFeature',
  "from 'mongoose'",
  "from '@nestjs/mongoose'",
  '.populate(',
];

/** Still Mongo-backed BY PLAN: [path substring, removing phase]. Empty: the runtime no longer needs MongoDB. */
const ALLOWLIST: Array<[string, string]> = [];

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('no-mongoose gate (F.3)', () => {
  const srcDir = path.resolve(__dirname, '..', '..');
  const offenders: string[] = [];

  it('finds no Mongoose usage outside the documented Mongo-backed modules', () => {
    const files = walk(srcDir, []);
    for (const file of files) {
      const rel = path.relative(srcDir, file).split(path.sep).join('/');
      const content = fs.readFileSync(file, 'utf8');
      const allow = ALLOWLIST.find(([p]) => rel.includes(p));
      if (allow) continue;
      for (const marker of FORBIDDEN) {
        if (content.includes(marker)) {
          offenders.push(`${rel}: contains '${marker}'`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no duplicate allowlist entries (guards silent scope creep)', () => {
    const substrings = ALLOWLIST.map(([p]) => p);
    expect(new Set(substrings).size).toBe(ALLOWLIST.length);
  });
});
