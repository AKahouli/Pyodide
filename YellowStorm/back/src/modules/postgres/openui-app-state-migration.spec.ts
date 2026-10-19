import * as fs from 'node:fs';
import * as path from 'node:path';

describe('OpenUI state migration registration', () => {
  it('appends one ordered migration with bounded locks without rewriting earlier entries', () => {
    const dir = path.resolve(__dirname, '../../../drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entries = journal.entries;
    // After the security-branch merge, later migrations (conversation SSE events)
    // follow this one; locate it by tag instead of assuming it is last.
    const addedIndex = entries.findIndex(entry => entry.tag === '0052_openui_app_states');
    expect(addedIndex).toBeGreaterThan(-1);
    const added = entries[addedIndex];
    expect(added.idx).toBe(addedIndex);
    expect(added.when).toBeGreaterThan(Math.max(...entries.slice(0, addedIndex).map(entry => entry.when)));
    expect(entries.filter(entry => entry.tag === added.tag)).toHaveLength(1);
    const migration = fs.readFileSync(path.join(dir, `${added.tag}.sql`), 'utf8');
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
    expect(migration.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(migration).toContain('"conversation"."openui_app_states"');
  });
});
