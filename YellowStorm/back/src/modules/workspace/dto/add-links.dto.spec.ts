import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddLinksDto } from './add-links.dto';

async function errorsFor(obj: Record<string, unknown>) {
  return validate(plainToInstance(AddLinksDto, obj));
}

describe('AddLinksDto sourceRootUrl', () => {
  it('accepts a valid sourceRootUrl', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'], sourceRootUrl: 'https://a.com' });
    expect(errors).toHaveLength(0);
  });

  it('allows sourceRootUrl to be omitted', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'] });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-url sourceRootUrl', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'], sourceRootUrl: 'not a url' });
    expect(errors.some((e) => e.property === 'sourceRootUrl')).toBe(true);
  });
});
