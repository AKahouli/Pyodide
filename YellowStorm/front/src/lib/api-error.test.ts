import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { apiErrorDetails } from './api-error';

const refused = (details: unknown) => new AxiosError('refused', 'ERR_BAD_REQUEST', undefined, undefined, {
  status: 400, statusText: 'Bad Request', headers: {}, config: {} as never,
  data: { success: false, error: { code: 'ERR_3704', message: 'refused', statusCode: 400, details } },
});

describe('apiErrorDetails', () => {
  it('gives the reasons an answer carries, and nothing for an answer without any', () => {
    expect(apiErrorDetails(refused([{ field: 'm-1', message: ' Customer: source changed ' }, { field: 'x' }, { message: '' }, null])))
      .toEqual(['Customer: source changed']);
    expect(apiErrorDetails(refused(undefined))).toEqual([]);
    expect(apiErrorDetails(refused('text'))).toEqual([]);
    expect(apiErrorDetails(new Error('boom'))).toEqual([]);
  });
});
