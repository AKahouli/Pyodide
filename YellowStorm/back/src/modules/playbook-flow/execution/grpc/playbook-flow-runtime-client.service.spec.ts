import { ConfigService } from '@nestjs/config';

import { PlaybookFlowRuntimeClientService } from './playbook-flow-runtime-client.service';

describe('PlaybookFlowRuntimeClientService', () => {
  it('starts unavailable before initialization', () => {
    const service = new PlaybookFlowRuntimeClientService({
      get: jest.fn().mockReturnValue('localhost:50051'),
    } as unknown as ConfigService);

    expect(service.isAvailable()).toBe(false);
  });
});
