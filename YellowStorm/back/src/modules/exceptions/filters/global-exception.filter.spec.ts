import { HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter request URL redaction', () => {
  it('does not expose bearer query parameters in responses or logs', () => {
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const config = { get: jest.fn().mockReturnValue('test') };
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }) };
    const request = {
      url: '/api/v1/conversations/stream?token=secret-bearer&cursor=42',
      method: 'GET',
      headers: {},
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
    const filter = new GlobalExceptionFilter(logger as never, config as never);

    filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host as never);

    const body = json.mock.calls[0][0];
    const loggedData = logger.warn.mock.calls[0][1];
    expect(body.error.path).not.toContain('secret-bearer');
    expect(body.error.path).toContain('cursor=42');
    expect(loggedData.path).toBe(body.error.path);
  });
});
