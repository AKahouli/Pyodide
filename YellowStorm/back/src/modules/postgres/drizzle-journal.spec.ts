import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Remediation 5.4: migration journal integrity. Guards against the R-23
 * failure mode where a migration exists but is missing from (or ordered
 * inconsistently within) the drizzle journal, or where new files silently
 * skip the lock-timeout header.
 */
describe('drizzle migration journal integrity', () => {
  const drizzleDir = path.resolve(__dirname, '..', '..', '..', 'drizzle');
  // src/modules/postgres/drizzle-journal.spec.ts → back/drizzle
  const journal: { entries: { idx: number; when: number; tag: string }[] } = JSON.parse(
    fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8'),
  );

  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  /** 0002–0004 predate the journal and are explicitly accepted. */
  const UNJOURNALED_ALLOWLIST = ['0002', '0003', '0004'];

  it('every numbered migration (0006+) has a journal entry', () => {
    const tags = new Set(journal.entries.map((e) => e.tag));
    const missing = sqlFiles.filter(
      (f) => {
        const num = f.slice(0, 4);
        return !UNJOURNALED_ALLOWLIST.includes(num) && !tags.has(f.replace(/\.sql$/, ''));
      },
    );
    expect(missing).toEqual([]);
  });

  it('journal when values are strictly increasing and unique', () => {
    const whens = journal.entries.map((e) => e.when);
    for (let i = 1; i < whens.length; i++) {
      expect(whens[i]).toBeGreaterThan(whens[i - 1]);
    }
    expect(new Set(whens).size).toBe(whens.length);
  });

  it('journal indexes are contiguous starting at 0', () => {
    journal.entries.forEach((e, i) => { expect(e.idx).toBe(i); });
  });

  // Already applied to the shared database out of band (ledger hash c7d0dbd304f8) by another branch: the file must
  // stay byte-identical to what was recorded, so it is exempt instead of edited. One idempotent ADD COLUMN.
  const APPLIED_OUT_OF_BAND = new Set(['0026_model_drop_params.sql']);

  // Already-deployed SQL cannot gain headers without changing its ledger hash.
  // Migration entry points enforce the timeout at connection startup instead.
  // Git blob IDs (LF-normalized) pin these exact historical exceptions.
  const HISTORICAL_HEADER_EXCEPTIONS: Record<string, string> = {
    '0046_concurrent_root_turns.sql': '461bd68d296e4033e8aa8c693c6a07be5a41616a',
    '0050_model_conversation_api.sql': 'e375dce66d21241bcf7b26ff453f7a3d734d914c',
    '0051_model_responses_history_controls.sql': 'd5667438053060ca825757c0a526d78127069ae4',
  };

  it('preserves deployed SQL for historical header exceptions', () => {
    for (const [file, blobId] of Object.entries(HISTORICAL_HEADER_EXCEPTIONS)) {
      const sql = fs.readFileSync(path.join(drizzleDir, file), 'utf8').replace(/\r\n/g, '\n');
      const hash = createHash('sha1').update(`blob ${Buffer.byteLength(sql)}\0`).update(sql).digest('hex');
      expect({ file, hash }).toEqual({ file, hash: blobId });
    }
  });

  it('every non-historical migration numbered 0025+ declares SET LOCAL lock_timeout', () => {
    const offenders = sqlFiles
      .filter((f) => Number(f.slice(0, 4)) >= 25)
      .filter((f) => !APPLIED_OUT_OF_BAND.has(f))
      .filter((f) => !Object.prototype.hasOwnProperty.call(HISTORICAL_HEADER_EXCEPTIONS, f))
      .filter((f) => !fs.readFileSync(path.join(drizzleDir, f), 'utf8').includes("SET LOCAL lock_timeout = '5s';"))
      .map((f) => f);
    expect(offenders).toEqual([]);
  });
});
