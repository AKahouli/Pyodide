import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ForbiddenException, TooManyRequestsException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { AiProxyExceptionFilter } from './ai-proxy-exception.filter';

describe('AiProxyExceptionFilter', () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });

  const createHost = (): ArgumentsHost =>
    ({
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    }) as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps rate limit errors to OpenAI rate_limit_error', () => {
    new AiProxyExceptionFilter().catch(
      new TooManyRequestsException('Rate limit exceeded'),
      createHost(),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith({
      error: {
        message: 'Rate limit exceeded',
        type: 'rate_limit_error',
      },
    });
  });

  it('maps usage budget errors to OpenAI insufficient_quota with 429', () => {
    new AiProxyExceptionFilter().catch(
      new ForbiddenException(ErrorCode.USAGE_LIMIT_EXCEEDED, 'Token budget exceeded'),
      createHost(),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith({
      error: {
        message: 'Token budget exceeded',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    });
  });
});
