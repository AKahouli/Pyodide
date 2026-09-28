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
    get: jest.fn((key: string, defaultValue?: unknown) =>
      Object.prototype.hasOwnProperty.call(configValues, key) ? configValues[key] : defaultValue,
    ),
  };
  const revisions = {
    patchRevisionWithFiles: jest.fn().mockResolvedValue(undefined),
    getAuthorizedRevision: jest.fn().mockResolvedValue({
      files: [
        { path: 'src/lib/app-base.js' },
        { path: 'src/AppRouter.jsx' },
        { path: 'src/main.jsx' },
        { path: 'vite.config.js' },
      ],
    }),
    readRevisionFileText: jest.fn().mockImplementation(async (_workspaceId, _revisionId, path) => {
      if (path.endsWith('app-base.js')) return 'export function resolveRouterBasename() {}';
      if (path.endsWith('vite.config.js')) {
        return "base: process.env.VITE_APP_BASE || '/',";
      }
      if (path.endsWith('AppRouter.jsx')) {
        return '<BrowserRouter basename={resolveRouterBasename()}>;';
      }
      return "import AppRouter from './AppRouter';";
    }),
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
    delete configValues['app.backendUrl'];
    delete configValues['app.nodeEnv'];
    delete configValues['appRuntime.publicBaseUrl'];
    delete process.env.ALLOW_LOCALHOST_DEPLOY_API;
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

  it('injects public BACKEND_URL as VITE_YM_API_BASE_URL', async () => {
    configValues['app.backendUrl'] = 'https://api.yellowsys.org';
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      }),
    );

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).resolves.toEqual({
      appId: '2e65d5fa87a0499f',
      url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      revisionId: undefined,
      runtimeEnv: {
        VITE_APP_BASE: '/apps/2e65d5fa87a0499f/',
        VITE_YM_API_BASE_URL: 'https://api.yellowsys.org/api/v1',
      },
    });
  });

  it('uses an existing public runtime base when BACKEND_URL is loopback', async () => {
    configValues['app.backendUrl'] = 'http://localhost:3000';
    configValues['app.nodeEnv'] = 'production';
    configValues['appRuntime.publicBaseUrl'] = 'https://api.yellowsys.org';
    delete process.env.ALLOW_LOCALHOST_DEPLOY_API;
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      }),
    );

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).resolves.toMatchObject({
      runtimeEnv: {
        VITE_YM_API_BASE_URL: 'https://api.yellowsys.org/api/v1',
      },
    });
  });

  it('does not inject a loopback API URL into apps without an AI client', async () => {
    configValues['app.backendUrl'] = 'http://localhost:3000';
    configValues['app.nodeEnv'] = 'development';
    const fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      }),
    );

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).resolves.toMatchObject({
      runtimeEnv: { VITE_APP_BASE: '/apps/2e65d5fa87a0499f/' },
    });
    const launchBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(launchBody.runtimeEnv).not.toContain('localhost');
  });

  it('requires a public API base before deploying an app with the AI client', async () => {
    configValues['app.backendUrl'] = 'http://localhost:3000';
    revisions.getAuthorizedRevision.mockResolvedValueOnce({
      files: [
        { path: 'src/lib/app-base.js' },
        { path: 'src/AppRouter.jsx' },
        { path: 'src/main.jsx' },
        { path: 'src/lib/yellowmind-ai.js' },
        { path: 'vite.config.js' },
      ],
    });

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      /Set BACKEND_URL to the browser-reachable YellowStorm API origin/,
    );
  });

  it('rejects an auth client that builds auth URLs from the platform API base', async () => {
    revisions.getAuthorizedRevision.mockResolvedValueOnce({
      files: [
        { path: 'src/lib/app-base.js' },
        { path: 'src/AppRouter.jsx' },
        { path: 'src/main.jsx' },
        { path: 'src/lib/yellowmind-auth.js' },
        { path: 'vite.config.js' },
      ],
    });
    const readSource = revisions.readRevisionFileText.getMockImplementation()!;
    revisions.readRevisionFileText.mockImplementation(async (workspaceId, id, path) => {
      if (path.endsWith('yellowmind-auth.js')) {
        return "const API_BASE = import.meta.env.VITE_YM_API_BASE_URL; fetch(`${API_BASE}/auth/register`);";
      }
      return readSource(workspaceId, id, path);
    });

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      /App authentication must use the App Data auth client/,
    );
  });

  it('rejects auth-enabled apps when App Data was not provisioned for PROD', async () => {
    revisions.getAuthorizedRevision.mockResolvedValueOnce({
      files: [
        { path: 'src/lib/app-base.js' },
        { path: 'src/AppRouter.jsx' },
        { path: 'src/main.jsx' },
        { path: 'src/lib/yellowmind-auth.js' },
        { path: 'vite.config.js' },
      ],
    });
    const readSource = revisions.readRevisionFileText.getMockImplementation()!;
    revisions.readRevisionFileText.mockImplementation(async (workspaceId, id, path) => {
      if (path.endsWith('yellowmind-auth.js')) {
        return "const url = import.meta.env.VITE_YM_APP_DATA_URL; fetch(`${url}/auth/register`);";
      }
      return readSource(workspaceId, id, path);
    });

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      /App Data is not provisioned for this workspace/,
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
    const rejection = expect(deployment).rejects.toThrow(
      /Deployment service timed out .*lastStatus=deploying/,
    );
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

  it('explains the required Vite and router changes when template base-path support is missing', async () => {
    revisions.getAuthorizedRevision.mockResolvedValueOnce({ files: [{ path: 'src/main.jsx' }] });
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(service.deploy('2e65d5fa87a0499f', 'template_tpl_1')).rejects.toThrow(
      /VITE_APP_BASE.*src\/lib\/app-base\.js or \.ts.*resolveRouterBasename/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts JavaScript base-path helpers wired into the Vite build and BrowserRouter', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      }),
    );

    await expect(service.deploy('2e65d5fa87a0499f', 'template_tpl_1')).resolves.toMatchObject({
      url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
    });
    expect(revisions.readRevisionFileText).toHaveBeenCalledWith(
      '2e65d5fa87a0499f',
      'template_tpl_1',
      'src/lib/app-base.js',
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
