import { ValidationPipe } from '@nestjs/common';
import { AssistantDescribeDataQueryDto, AssistantQueryRecordsDto } from './semantic-graph-search.dto';

describe('AssistantQueryRecordsDto', () => {
  // The same options as the application's global pipe (main.ts).
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
    stopAtFirstError: true,
  });
  const transform = async (body: Record<string, unknown>): Promise<AssistantQueryRecordsDto> =>
    (await pipe.transform(body, { type: 'body', metatype: AssistantQueryRecordsDto })) as AssistantQueryRecordsDto;

  it('keeps filter values as sent: text, numbers, yes/no, lists and relative periods', async () => {
    const filters = [
      { field: "Domaine de l'expéditeur", op: 'eq', value: 'yellowsys.fr' },
      { field: 'amount', op: 'between', value: [10, '1 000,50'] },
      { field: 'paid', op: 'eq', value: true },
      { field: 'status', op: 'in', value: ['paid', 'sent'] },
      { field: 'received', op: 'between', value: 'last_3_months' },
      { field: 'notes', op: 'gte', value: '2026-01-01', as: 'date' },
      { field: 'envoyé par.domaine', op: 'is_empty' },
    ];
    const dto = await transform({
      concept: 'Message e-mail', filters, match: 'any', groupBy: [{ field: 'received', bucket: 'month' }],
      aggregates: [{ op: 'count' }, { op: 'count_distinct', field: 'sender' }], orderBy: [{ field: 'count', direction: 'desc' }],
      fields: ['subject'], limit: 0, offset: 50, data: 'draft',
    });
    expect(dto.filters).toEqual(filters);
    expect(dto).toMatchObject({ concept: 'Message e-mail', match: 'any', limit: 0, offset: 50, data: 'draft' });
    expect(dto.groupBy).toEqual([{ field: 'received', bucket: 'month' }]);
  });

  it.each([
    [{ filters: [{ field: 'x', op: 'like', value: 'a' }] }],
    [{ filters: [{ field: '', op: 'eq', value: 'a' }] }],
    [{ filters: [{ field: 'x', op: 'eq', value: 'a', sql: '1=1' }] }],
    [{ filters: [{ field: 'x', op: 'eq', value: 'a', as: 'json' }] }],
    [{ filters: Array.from({ length: 21 }, () => ({ field: 'x', op: 'not_empty' })) }],
    [{ groupBy: [{ field: 'a' }, { field: 'b' }, { field: 'c' }] }],
    [{ groupBy: [{ field: 'date', bucket: 'hour' }] }],
    [{ aggregates: [{ op: 'median', field: 'amount' }] }],
    [{ orderBy: [{ field: 'amount', direction: 'up' }] }],
    [{ match: 'some' }],
    [{ limit: 201 }],
    [{ limit: -1 }],
    [{ offset: 100001 }],
    [{ data: 'production' }],
    [{ concept: '' }],
  ])('refuses a malformed query: %j', async (part) => {
    await expect(transform({ concept: 'Invoice', ...part })).rejects.toThrow();
  });

  it('reads published data unless the draft is asked for', async () => {
    const pipeQuery = async (query: Record<string, unknown>): Promise<AssistantDescribeDataQueryDto> =>
      (await pipe.transform(query, { type: 'query', metatype: AssistantDescribeDataQueryDto })) as AssistantDescribeDataQueryDto;
    await expect(pipeQuery({})).resolves.toEqual({});
    await expect(pipeQuery({ data: 'draft' })).resolves.toEqual({ data: 'draft' });
    await expect(pipeQuery({ data: 'live' })).rejects.toThrow();
  });
});
