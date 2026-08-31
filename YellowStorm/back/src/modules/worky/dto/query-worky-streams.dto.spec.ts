import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryWorkyStreamsDto } from './query-worky-streams.dto';

describe('QueryWorkyStreamsDto', () => {
  async function build(payload: Record<string, unknown>) {
    const dto = plainToInstance(QueryWorkyStreamsDto, payload);
    const errors = await validate(dto);
    return { dto, errors };
  }

  function hasError(errors: Awaited<ReturnType<typeof validate>>, property: string): boolean {
    return errors.some((e) => e.property === property);
  }

  it('accepts an empty query (all params optional)', async () => {
    const { errors } = await build({});
    expect(errors).toHaveLength(0);
  });

  it('coerces page and limit to numbers', async () => {
    const { dto, errors } = await build({ page: '2', limit: '12' });
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(12);
  });

  it('rejects a page below 1', async () => {
    const { errors } = await build({ page: '0' });
    expect(hasError(errors, 'page')).toBe(true);
  });

  it('rejects a limit above the max', async () => {
    const { errors } = await build({ limit: '101' });
    expect(hasError(errors, 'limit')).toBe(true);
  });

  it('normalizes a single status value into an array', async () => {
    const { dto, errors } = await build({ status: 'active' });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['active']);
  });

  it('accepts multiple valid statuses', async () => {
    const { dto, errors } = await build({ status: ['active', 'paused'] });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['active', 'paused']);
  });

  it('rejects an unknown status', async () => {
    const { errors } = await build({ status: ['bogus'] });
    expect(hasError(errors, 'status')).toBe(true);
  });

  it('accepts a valid sort field and direction', async () => {
    const { errors } = await build({ sort: 'created', sortDir: 'asc' });
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown sort field', async () => {
    const { errors } = await build({ sort: 'progress' });
    expect(hasError(errors, 'sort')).toBe(true);
  });

  it('accepts ISO date bounds', async () => {
    const { errors } = await build({
      createdFrom: '2026-01-01T00:00:00.000Z',
      createdTo: '2026-02-01T00:00:00.000Z',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-ISO createdFrom', async () => {
    const { errors } = await build({ createdFrom: 'not-a-date' });
    expect(hasError(errors, 'createdFrom')).toBe(true);
  });
});
