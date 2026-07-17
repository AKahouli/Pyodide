import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationV2DeployService } from './conversation-v2-deploy.service';

describe('ConversationV2DeployService', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'conversationV2.appBuilderDeployBaseUrl') {
        return 'https://builder.example/';
      }
      if (key === 'conversationV2.appBuilderDeployToken') return 'deploy-token';
      return undefined;
    }),
  };
  let service: ConversationV2DeployService;

  beforeEach(() => {
    jest.restoreAllMocks();
    config.get.mockClear();
    service = new ConversationV2DeployService(config as unknown as ConfigService);
  });

  it('posts the deployment identifiers and returns the deployed URL', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://apps.example/app-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(service.deploy('user-1', 'conversation-1')).resolves.toEqual({
      url: 'https://apps.example/app-1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://builder.example/app/deploy'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer deploy-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: 'user-1',
          conversation_id: 'conversation-1',
        }),
      }),
    );
  });

  it('surfaces an upstream error reported inside an HTTP 200 body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'package.json not found at /workspaces/app/projectSRC' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(service.deploy('user-1', 'conversation-1')).rejects.toThrow(
      'Deployment failed: package.json not found at /workspaces/app/projectSRC',
    );
  });

  it('rejects with a timeout error when the app-builder does not answer in time', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(service.deploy('user-1', 'conversation-1')).rejects.toThrow(
      'Deployment service timed out',
    );
  });

  it('fails immediately on a network error without waiting for the timeout', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));

    const startedAt = Date.now();
    await expect(service.deploy('user-1', 'conversation-1')).rejects.toThrow(
      'Deployment service is unavailable',
    );
    // Errors must short-circuit; only a silent upstream waits the full 3 min.
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('rejects an unsuccessful app-builder response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(null, { status: 502 }));

    await expect(service.deploy('user-1', 'conversation-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('falls back to the built-in endpoint when configuration is missing', async () => {
    config.get.mockReturnValue(undefined);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://apps.example/app-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(service.deploy('user-1', 'conversation-1')).resolves.toEqual({
      url: 'https://apps.example/app-1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://sandbox-v2.yellowsys.org/app/deploy'),
      expect.anything(),
    );
  });
});
