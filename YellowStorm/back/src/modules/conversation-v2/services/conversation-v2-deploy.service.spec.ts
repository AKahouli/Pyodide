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

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts deployment, waits 20 seconds, then returns the deployed app status', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying', app_id: 'conversation-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'deployed',
          app_id: 'conversation-1',
          url: 'https://apps.example/app-1',
        }),
      );

    const deployment = service.deploy('user-1', 'conversation-1');
    await jest.advanceTimersByTimeAsync(20_000);

    await expect(deployment).resolves.toEqual({
      appId: 'conversation-1',
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
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL('https://builder.example/app/status'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ conversation_id: 'conversation-1' }),
      }),
    );
  });

  it('polls again after 15 seconds while deployment remains in progress', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying', app_id: 'conversation-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'deployed',
          app_id: 'conversation-1',
          url: 'https://apps.example/app-1',
        }),
      );

    const deployment = service.deploy('user-1', 'conversation-1');
    await jest.advanceTimersByTimeAsync(35_000);

    await expect(deployment).resolves.toEqual({
      appId: 'conversation-1',
      url: 'https://apps.example/app-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops polling when the app-builder reports a failed status', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying', app_id: 'conversation-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed' }));

    const deployment = service.deploy('user-1', 'conversation-1');
    const rejection = expect(deployment).rejects.toThrow(
      'Deployment failed with an invalid status',
    );
    await jest.advanceTimersByTimeAsync(20_000);

    await rejection;
  });

  it('surfaces an upstream error reported inside an HTTP 200 body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'package.json not found at /workspaces/app/projectSRC' }),
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

  it('stops polling after the global three-minute deployment deadline', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying', app_id: 'conversation-1' }))
      .mockImplementation(() => Promise.resolve(jsonResponse({ status: 'deploying' })));

    const deployment = service.deploy('user-1', 'conversation-1');
    const rejection = expect(deployment).rejects.toThrow('Deployment service timed out');
    await jest.advanceTimersByTimeAsync(180_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });

  it('fails immediately on a network error without waiting for the timeout', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(service.deploy('user-1', 'conversation-1')).rejects.toThrow(
      'Deployment service is unavailable',
    );
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
      jsonResponse({
        status: 'deployed',
        app_id: 'conversation-1',
        url: 'https://apps.example/app-1',
      }),
    );

    await expect(service.deploy('user-1', 'conversation-1')).resolves.toEqual({
      appId: 'conversation-1',
      url: 'https://apps.example/app-1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://sandbox-v2.yellowsys.org/app/deploy'),
      expect.anything(),
    );
  });
});

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
