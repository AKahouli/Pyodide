import { ConfigService } from '@nestjs/config';
import {
  createGrpcMetadata,
  setGrpcCorrelationProvider,
  GrpcCorrelation,
} from './grpc-security.util';

describe('createGrpcMetadata correlation headers (plan P05)', () => {
  const config = { get: jest.fn().mockReturnValue('test-key') } as unknown as ConfigService;

  afterEach(() => {
    setGrpcCorrelationProvider(() => undefined);
  });

  it('attaches only the api key when the provider has no request context', () => {
    const metadata = createGrpcMetadata(config);
    expect(metadata.get('x-api-key')).toEqual(['test-key']);
    expect(metadata.get('traceparent')).toEqual([]);
    expect(metadata.get('x-request-id')).toEqual([]);
  });

  it('attaches traceparent / x-request-id / correlation-id from the provider', () => {
    const correlation: GrpcCorrelation = {
      traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
      requestId: 'req-1',
      correlationId: 'corr-1',
    };
    setGrpcCorrelationProvider(() => correlation);

    const metadata = createGrpcMetadata(config);

    expect(metadata.get('traceparent')).toEqual([correlation.traceparent]);
    expect(metadata.get('x-request-id')).toEqual(['req-1']);
    expect(metadata.get('correlation-id')).toEqual(['corr-1']);
  });
});
