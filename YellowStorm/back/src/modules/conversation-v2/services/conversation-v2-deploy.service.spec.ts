import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { ConversationV2DeployService } from './conversation-v2-deploy.service';

describe('ConversationV2DeployService', () => {
  const configValues: Record<string, string | number | undefined> = {
    'conversationV2.appBuilderDeployBaseUrl': 'https://app-deployer.yellowsys.org/',
    'conversationV2.appBuilderDeployToken': undefined,
    'conversationV2.appBuilderDeployTimeoutMs': 600_000,
    'conversationV2.appBuilderDeployInitialStatusDelayMs': 15_000,
    'conversationV2.appBuilderDeployStatusPollIntervalMs': 15_000,
    'conversationV2.appBuilderDeployedAppsPathPrefix': '/apps',
  };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
  };
  const revisions = {
    patchRevisionWithFiles: jest.fn().mockResolvedValue(undefined),
    getAuthorizedRevision: jest.fn().mockResolvedValue({
      files: [
        { path: 'src/lib/app-base.ts' },
        { path: 'src/main.jsx' },
      ],
    }),
    readRevisionFileText: jest.fn().mockResolvedValue("import { AppRouter } from './AppRouter';"),
  };
  let service: ConversationV2DeployService;

  beforeEach(() => {
    jest.restoreAllMocks();
    config.get.mockClear();
    revisions.patchRevisionWithFiles.mockClear();
    revisions.getAuthorizedRevision.mockClear();
    revisions.readRevisionFileText.mockClear();
    configValues['conversationV2.appBuilderDeployBaseUrl'] = 'https://app-deployer.yellowsys.org/';
    configValues['conversationV2.appBuilderDeployToken'] = undefined;
    configValues['conversationV2.appBuilderDeployTimeoutMs'] = 600_000;
    configValues['conversationV2.appBuilderDeployInitialStatusDelayMs'] = 15_000;
    configValues['conversationV2.appBuilderDeployStatusPollIntervalMs'] = 15_000;
    service = new ConversationV2DeployService(
      config as unknown as ConfigService,
      revisions as unknown as RuntimeRevisionService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts deployment, polls /app/deploy/status, then returns the ready URL', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying', app_id: '2e65d5fa87a0499f' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ready',
          app_id: '2e65d5fa87a0499f',
          revision_id: 'rev_15',
          url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
          preview_url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
        }),
      );

    const deployment = service.deploy('2e65d5fa87a0499f', 'rev_15');
    await jest.advanceTimersByTimeAsync(15_000);

    await expect(deployment).resolves.toEqual({
      appId: '2e65d5fa87a0499f',
      url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      revisionId: 'rev_15',
      runtimeEnv: { VITE_APP_BASE: '/apps/2e65d5fa87a0499f/' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://app-deployer.yellowsys.org/app/deploy'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"aiSessionId":"2e65d5fa87a0499f"'),
      }),
    );
    const launchBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(launchBody.revisionId).toMatch(/^rev_15_deploy_/);
    expect(launchBody.runtimeEnv).toBe(
      JSON.stringify({ VITE_APP_BASE: '/apps/2e65d5fa87a0499f/' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL('https://app-deployer.yellowsys.org/app/deploy/status'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ aiSessionId: '2e65d5fa87a0499f' }),
      }),
    );
  });

  it('prefers preview_url over url for the frontend iframe', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
        preview_url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/preview/',
      }),
    );

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).resolves.toEqual({
      appId: '2e65d5fa87a0499f',
      url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/preview/',
      revisionId: undefined,
      runtimeEnv: { VITE_APP_BASE: '/apps/2e65d5fa87a0499f/' },
    });
  });

  it('polls again after 15 seconds while deployment remains in progress', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying', app_id: '2e65d5fa87a0499f' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ready',
          app_id: '2e65d5fa87a0499f',
          url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
        }),
      );

    const deployment = service.deploy('2e65d5fa87a0499f', 'rev_15');
    await jest.advanceTimersByTimeAsync(30_000);

    await expect(deployment).resolves.toEqual({
      appId: '2e65d5fa87a0499f',
      url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      revisionId: undefined,
      runtimeEnv: { VITE_APP_BASE: '/apps/2e65d5fa87a0499f/' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops polling when the app-builder reports a failed status', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying', app_id: '2e65d5fa87a0499f' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed' }));

    const deployment = service.deploy('2e65d5fa87a0499f', 'rev_15');
    const rejection = expect(deployment).rejects.toThrow(
      'Deployment failed with an invalid status',
    );
    await jest.advanceTimersByTimeAsync(15_000);

    await rejection;
  });

  it('surfaces an upstream error reported inside an HTTP 200 body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'revision manifest not found' }),
    );

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      'Deployment failed: revision manifest not found',
    );
  });

  it('rejects with a timeout error when the app-builder does not answer in time', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      'Deployment service timed out',
    );
  });

  it('stops polling after the configured deployment deadline', async () => {
    configValues['conversationV2.appBuilderDeployTimeoutMs'] = 180_000;
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'deploying', app_id: '2e65d5fa87a0499f' }))
      .mockImplementation(() => Promise.resolve(jsonResponse({ status: 'deploying' })));

    const deployment = service.deploy('2e65d5fa87a0499f', 'rev_15');
    const rejection = expect(deployment).rejects.toThrow('Deployment service timed out');
    await jest.advanceTimersByTimeAsync(180_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });

  it('fails immediately on a network error without waiting for the timeout', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      'Deployment service is unavailable',
    );
  });

  it('rejects an unsuccessful app-builder response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(null, { status: 502 }));

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('resolves deployed app base path for Vite subpath routing', () => {
    expect(service.resolveDeployAppBasePath('2cacade0981746b5')).toBe(
      '/apps/2cacade0981746b5/',
    );
  });

  it('sends a bearer token when configured', async () => {
    configValues['conversationV2.appBuilderDeployToken'] = 'deploy-token';
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      }),
    );

    await service.deploy('2e65d5fa87a0499f', 'rev_15');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer deploy-token',
          'Content-Type': 'application/json',
        },
      }),
    );
  });
});

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
