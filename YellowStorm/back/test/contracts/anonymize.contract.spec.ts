import * as fs from 'node:fs';
import * as path from 'node:path';
import { anonymize, collectEmails } from './anonymize';

describe('contract fixture anonymizer', () => {
  it('maps distinct emails to user-N@example.test deterministically (sorted by value)', () => {
    const input = { a: 'zed@corp.io', b: ['amy@corp.io', 'zed@corp.io'], c: 'mail amy@corp.io now' };
    const out = anonymize(input);
    expect(out).toEqual({ a: 'user-2@example.test', b: ['user-1@example.test', 'user-2@example.test'], c: 'mail user-1@example.test now' });
    expect(anonymize(input)).toEqual(out);
  });

  it('replaces person names and is idempotent', () => {
    const out = anonymize({ profile: { firstName: 'Jane', lastName: 'Roe', company: 'Acme' }, email: 'jane@acme.io' });
    expect(out.profile).toEqual({ firstName: 'First', lastName: 'Last', company: 'Company' });
    expect(anonymize(out)).toEqual(out);
  });

  it('committed contract fixtures contain no non-example emails', () => {
    const dir = path.join(__dirname, 'http');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const emails = [...collectEmails(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))];
      expect(emails.filter((e) => !/@example\.(test|com)$/.test(e))).toEqual([]);
    }
  });
});
