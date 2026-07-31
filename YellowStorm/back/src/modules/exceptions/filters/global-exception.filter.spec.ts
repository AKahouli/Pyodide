import { HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ErrorCode } from '../constants/error-codes';

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

describe('GlobalExceptionFilter Multer LIMIT_FILE_SIZE', () => {
  it('maps MulterError LIMIT_FILE_SIZE to 413', () => {
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const config = { get: jest.fn().mockReturnValue('test') };
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }) };
    const request = { url: '/api/v1/workspaces/x/documents', method: 'POST', headers: {} };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
    const filter = new GlobalExceptionFilter(logger as never, config as never);

    const multerError = Object.assign(new Error('File too large'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE',
    });
    filter.catch(multerError, host as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe(ErrorCode.WORKSPACE_STORAGE_FILE_TOO_LARGE);
    expect(body.error.statusCode).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
  });
});
