import * as fs from 'fs';
import * as path from 'path';

/**
 * F.3 / remediation 4.7: enforceable no-Mongoose gate for every module that
 * has been migrated to Postgres. Scans all non-spec .ts files under src/ and
 * fails on any Mongoose usage. Allowlisted paths carry the phase that removes
 * them — later phases shrink this list to zero.
 */
const FORBIDDEN = [
  '@InjectModel(',
  '@InjectConnection(',
  'MongooseModule.forFeature',
  "from 'mongoose'",
  "from '@nestjs/mongoose'",
  '.populate(',
];

/** Still Mongo-backed BY PLAN: [path substring, removing phase]. */
const ALLOWLIST: Array<[string, string]> = [
  ['modules/playbook-flow/', 'P5 playbook-flow'],
  ['modules/worky/', 'P7 worky'],
  ['modules/knowledge-intelligence/', 'P6 knowledge-intelligence'],
  ['modules/classifier/', 'P6 classifier'],
  ['modules/evaluation/', 'P6 evaluation'],
  ['modules/integration-events/', 'P8 integration-events'],
  ['modules/logger/', 'P9 logger'],
  ['modules/database/', 'P9 logger (connection shell)'],
  ['modules/health/', 'health Mongo ping (P9)'],
  ['modules/user/schemas/user.schema.ts', 'legacy UserDocument type until ai-proxy drops it'],
  ['modules/connector/services/connector-playbook-binding-sync.service.ts', 'bridge — removed with P5'],
];

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
