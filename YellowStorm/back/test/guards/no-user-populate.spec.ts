import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Plan 1A.11 guard: after identity moves to PostgreSQL, hydrating users via
 * Mongoose populate or direct User-model injection silently returns null.
 * These patterns are allowed ONLY inside the user module's own persistence
 * (the Mongo store/lookup adapters, deleted at the cutover) and the auth/
 * authorization persistence stores that carry a sanctioned User-model
 * injection for their Mongo implementations.
 */

const SRC = path.join(__dirname, '..', '..', 'src');

const POPULATE_PATTERNS = [/\.populate\(\s*['"]sharedWith['"]/, /\.populate\(\s*['"]sharedBy['"]/, /\.populate\(\s*['"]members['"]/, /\.populate\(\s*['"]roles['"]/];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('no-user-populate guard', () => {
  it('has no Mongoose user populates outside sanctioned persistence files', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const posix = file.replace(/\\/g, '/');
      const sanctioned =
        posix.includes('/modules/user/persistence/') ||
        posix.includes('/modules/user-group/persistence/');
      if (sanctioned) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (POPULATE_PATTERNS.some((p) => p.test(content))) offenders.push(path.relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('has no @InjectModel(User.name) outside the user module and sanctioned stores', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const posix = file.replace(/\\/g, '/');
      const sanctioned =
        posix.includes('/modules/user/') ||
        posix.includes('/modules/auth/persistence/') ||
        posix.includes('/modules/authorization/persistence/');
      if (sanctioned) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes("@InjectModel(User.name)")) offenders.push(path.relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
