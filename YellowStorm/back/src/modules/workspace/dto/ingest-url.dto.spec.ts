import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestUrlDto } from './ingest-url.dto';

const base = {
  downloadUrl: 'https://example.sharepoint.com/download',
  filename: 'report.xlsx',
  userId: '507f191e810c19729de860ea',
};

async function errorsFor(obj: Record<string, unknown>) {
  return validate(plainToInstance(IngestUrlDto, obj));
}

describe('IngestUrlDto', () => {
  it('accepts a valid https ingest payload', async () => {
    const errors = await errorsFor(base);
    expect(errors).toHaveLength(0);
  });

  it('accepts Authorization-only authHeaders', async () => {
    const errors = await errorsFor({
      ...base,
      authHeaders: { Authorization: 'Bearer token' },
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects http downloadUrl', async () => {
    const errors = await errorsFor({ ...base, downloadUrl: 'http://example.com/file' });
    expect(errors.some((e) => e.property === 'downloadUrl')).toBe(true);
  });

  it('rejects localhost-style hosts (require_tld)', async () => {
    const errors = await errorsFor({ ...base, downloadUrl: 'https://localhost/file' });
    expect(errors.some((e) => e.property === 'downloadUrl')).toBe(true);
  });

  it('rejects non-Authorization authHeaders keys', async () => {
    const errors = await errorsFor({
      ...base,
      authHeaders: { Authorization: 'Bearer x', 'X-Custom': 'leak' },
    });
    expect(errors.some((e) => e.property === 'authHeaders')).toBe(true);
  });
});
