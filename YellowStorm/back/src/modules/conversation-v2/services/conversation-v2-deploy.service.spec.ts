import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { AppDataDeploymentService } from '@modules/app-data/services/app-data-deployment.service';
import { PlatformBaselineService } from '@modules/app-runtime/platform-kit/platform-baseline.service';
import { DEFAULT_STARTER_REVISION_ID } from '@modules/app-runtime/constants/starter-revisions';
import { ConversationV2DeployService } from './conversation-v2-deploy.service';

describe('ConversationV2DeployService', () => {
  const configValues: Record<string, string | number | boolean | undefined> = {
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
  const planBaseline = jest.fn();
  const baseline = { planBaseline };
  const revisions = {
    patchRevisionWithFiles: jest.fn().mockResolvedValue(undefined),
    getAuthorizedRevision: jest.fn(),
    readRevisionFileText: jest.fn(),
    listFiles: jest.fn(),
    starterRevisionId: DEFAULT_STARTER_REVISION_ID,
  };
  let service: ConversationV2DeployService;

  const defaultRevisionFiles = [
    { path: 'src/lib/app-base.js' },
    { path: 'src/AppRouter.jsx' },
    { path: 'src/main.jsx' },
    { path: 'vite.config.js' },
  ];

  beforeEach(() => {
    jest.restoreAllMocks();
    config.get.mockClear();
    revisions.patchRevisionWithFiles.mockClear();
    revisions.getAuthorizedRevision.mockReset();
    revisions.readRevisionFileText.mockReset();
    revisions.listFiles.mockReset();
    planBaseline.mockReset();
    planBaseline.mockResolvedValue({
      mode: 'deploy',
      files: [],
      violations: [],
      warnings: [],
      entry: 'src/main.jsx',
      appRoot: 'src/App.jsx',
    });
    revisions.getAuthorizedRevision.mockResolvedValue({ files: defaultRevisionFiles });
    revisions.listFiles.mockResolvedValue({ files: defaultRevisionFiles });
    revisions.readRevisionFileText.mockImplementation(async (_workspaceId, _revisionId, path) => {
      if (path.endsWith('app-base.js')) return 'export function resolveRouterBasename() {}';
      if (path.endsWith('vite.config.js')) {
        return "base: process.env.VITE_APP_BASE || '/',";
      }
      if (path.endsWith('AppRouter.jsx')) {
        return '<BrowserRouter basename={resolveRouterBasename()}>;';
      }
      return "import AppRouter from './AppRouter';";
    });
    configValues['conversationV2.appBuilderDeployBaseUrl'] = 'https://app-deployer.yellowsys.org/';
    configValues['conversationV2.appBuilderDeployToken'] = undefined;
    configValues['conversationV2.appBuilderDeployTimeoutMs'] = 600_000;
    configValues['conversationV2.appBuilderDeployInitialStatusDelayMs'] = 15_000;
    configValues['conversationV2.appBuilderDeployStatusPollIntervalMs'] = 15_000;
    delete configValues['app.backendUrl'];
    delete configValues['app.nodeEnv'];
    delete configValues['appRuntime.publicBaseUrl'];
    delete configValues['appData.enabled'];
    delete process.env.ALLOW_LOCALHOST_DEPLOY_API;
    service = new ConversationV2DeployService(
      config as unknown as ConfigService,
      revisions as unknown as RuntimeRevisionService,
      baseline as unknown as PlatformBaselineService,
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
    revisions.listFiles.mockResolvedValue({
      files: [{ path: 'src/pages/Chat.jsx' }, ...defaultRevisionFiles],
    });
    const readSource = revisions.readRevisionFileText.getMockImplementation()!;
    revisions.readRevisionFileText.mockImplementation(async (workspaceId, id, path) => {
      if (path.endsWith('Chat.jsx')) {
        return "import { createAIClient } from '@/lib/yellowmind-ai';\nexport function Chat() { createAIClient(); }";
      }
      return readSource(workspaceId, id, path);
    });
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
    revisions.listFiles.mockResolvedValue({
      files: [{ path: 'src/pages/Chat.jsx' }, ...defaultRevisionFiles],
    });
    const readSource = revisions.readRevisionFileText.getMockImplementation()!;
    revisions.readRevisionFileText.mockImplementation(async (workspaceId, id, path) => {
      if (path.endsWith('Chat.jsx')) {
        return "import { chatCompletion } from '@/lib/yellowmind-ai';";
      }
      return readSource(workspaceId, id, path);
    });
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
    const aiRevisionFiles = [
      { path: 'src/lib/app-base.js' },
      { path: 'src/AppRouter.jsx' },
      { path: 'src/main.jsx' },
      { path: 'src/pages/Chat.jsx' },
      { path: 'src/lib/yellowmind-ai.js' },
      { path: 'vite.config.js' },
    ];
    revisions.getAuthorizedRevision.mockResolvedValue({ files: aiRevisionFiles });
    revisions.listFiles.mockResolvedValue({ files: aiRevisionFiles });
    const readSource = revisions.readRevisionFileText.getMockImplementation()!;
    revisions.readRevisionFileText.mockImplementation(async (workspaceId, revisionId, path) => {
      if (path.endsWith('Chat.jsx')) {
        return "import { createAIClient } from '@/lib/yellowmind-ai';\nexport function Chat() { createAIClient(); }";
      }
      return readSource(workspaceId, revisionId, path);
    });

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      /browser-reachable YellowStorm API origin/,
    );
  });

  it('does not require a public API base when only the starter yellowmind-ai library is present', async () => {
    configValues['app.backendUrl'] = 'http://localhost:3000';
    const authRevisionFiles = [
      { path: 'src/lib/app-base.js' },
      { path: 'src/AppRouter.jsx' },
      { path: 'src/main.jsx' },
      { path: 'src/lib/yellowmind-ai.js' },
      { path: 'vite.config.js' },
    ];
    revisions.getAuthorizedRevision.mockResolvedValue({ files: authRevisionFiles });
    revisions.listFiles.mockResolvedValue({ files: authRevisionFiles });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      }),
    );

    const result = await service.deploy('2e65d5fa87a0499f', 'rev_15');
    expect(result.runtimeEnv?.VITE_YM_API_BASE_URL).toBeUndefined();
    const launchBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(launchBody.runtimeEnv).not.toContain('VITE_YM_API_BASE_URL');
  });

  it('refuses to deploy when the platform baseline reports a violation', async () => {
    planBaseline.mockResolvedValue({
      mode: 'deploy',
      files: [],
      violations: [
        'src/lib/yellowmind-auth.tsx: Auth must read import.meta.env.VITE_YM_APP_DATA_URL.',
      ],
      warnings: [],
      entry: 'src/main.jsx',
      appRoot: 'src/App.jsx',
    });
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      /platform contract.*VITE_YM_APP_DATA_URL/i,
    );
    expect(revisions.patchRevisionWithFiles).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restores platform files the agent deleted instead of failing the deploy', async () => {
    planBaseline.mockResolvedValue({
      mode: 'deploy',
      files: [{ path: 'src/lib/ym-diag.ts', content: 'export const ymDiag = {};' }],
      violations: [],
      warnings: [],
      entry: 'src/main.jsx',
      appRoot: 'src/App.jsx',
    });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      }),
    );

    await service.deploy('2e65d5fa87a0499f', 'rev_15');

    expect(revisions.patchRevisionWithFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalFiles: expect.arrayContaining([
          expect.objectContaining({ path: 'src/lib/ym-diag.ts' }),
          expect.objectContaining({ path: '.env.production' }),
        ]),
      }),
    );
  });

  it('rejects apps when App Data was not provisioned and no owner context', async () => {
    configValues['appData.enabled'] = true;
    const appDataDeployment = {
      ensureDevProvisioned: jest.fn(),
      prepareProduction: jest.fn().mockRejectedValue(new Error('not provisioned')),
      getRuntimeEnvForWorkspace: jest.fn().mockResolvedValue(null),
    };
    service = new ConversationV2DeployService(
      config as unknown as ConfigService,
      revisions as unknown as RuntimeRevisionService,
      baseline as unknown as PlatformBaselineService,
      appDataDeployment as unknown as AppDataDeploymentService,
    );

    await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
      /Provision App Data/,
    );
    expect(appDataDeployment.ensureDevProvisioned).not.toHaveBeenCalled();
  });

  it('always provisions DEV App Data before deploy', async () => {
    configValues['appData.enabled'] = true;
    const appDataDeployment = {
      ensureDevProvisioned: jest.fn().mockResolvedValue(undefined),
      prepareProduction: jest.fn().mockResolvedValue({
        appDataId: 'app-uuid',
        environment: 'prod',
        publicUrl: 'http://localhost:8443/v1/apps/app-uuid/prod',
      }),
      getRuntimeEnvForWorkspace: jest.fn(),
    };
    service = new ConversationV2DeployService(
      config as unknown as ConfigService,
      revisions as unknown as RuntimeRevisionService,
      baseline as unknown as PlatformBaselineService,
      appDataDeployment as unknown as AppDataDeploymentService,
    );
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        app_id: '2e65d5fa87a0499f',
        url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      }),
    );

    await expect(
      service.deploy('2e65d5fa87a0499f', 'rev_15', 'owner-user-1'),
    ).resolves.toMatchObject({
      runtimeEnv: {
        VITE_YM_APP_DATA_ID: 'app-uuid',
        VITE_YM_APP_DATA_ENV: 'prod',
      },
    });
    expect(appDataDeployment.ensureDevProvisioned).toHaveBeenCalledWith(
      '2e65d5fa87a0499f',
      'owner-user-1',
    );
    expect(appDataDeployment.prepareProduction).toHaveBeenCalledWith(
      '2e65d5fa87a0499f',
      'rev_15',
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

  it('verifies the platform baseline of the revision being deployed', async () => {
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
    expect(planBaseline).toHaveBeenCalledWith({
      workspaceId: '2e65d5fa87a0499f',
      revisionId: 'template_tpl_1',
      mode: 'deploy',
    });
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

  describe('deploy trace consolidation', () => {
    let lines: string[];

    beforeEach(() => {
      lines = [];
      const capture = (message: unknown) => {
        lines.push(String(message));
      };
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);
    });

    /** Every line must be greppable with a single `[deploy]` filter. */
    const expectEveryLinePrefixed = () => {
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.filter((line) => !line.startsWith('[deploy] '))).toEqual([]);
    };

    it('prefixes every line on the polling success path', async () => {
      jest.useFakeTimers();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          jsonResponse({ status: 'deploying', app_id: '2e65d5fa87a0499f' }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            status: 'ready',
            app_id: '2e65d5fa87a0499f',
            revision_id: 'rev_15',
            url: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
          }),
        );

      const deployment = service.deploy('2e65d5fa87a0499f', 'rev_15');
      await jest.advanceTimersByTimeAsync(15_000);
      await deployment;

      expectEveryLinePrefixed();
    });

    it('prefixes every line when App Data provisioning fails', async () => {
      configValues['appData.enabled'] = true;
      service = new ConversationV2DeployService(
        config as unknown as ConfigService,
        revisions as unknown as RuntimeRevisionService,
        baseline as unknown as PlatformBaselineService,
        {
          ensureDevProvisioned: jest.fn().mockResolvedValue(undefined),
          prepareProduction: jest.fn().mockRejectedValue('app data offline'),
          getRuntimeEnvForWorkspace: jest.fn(),
        } as unknown as AppDataDeploymentService,
      );

      await expect(
        service.deploy('2e65d5fa87a0499f', 'rev_15', 'owner-user-1'),
      ).rejects.toThrow(/Provision App Data/);

      // A non-Error rejection must still render its message, not "undefined".
      expect(lines.join('\n')).toContain(
        '[deploy] App Data prepareProduction failed session=2e65d5fa87a0499f ' +
          'revision=rev_15 error=app data offline',
      );
      expectEveryLinePrefixed();
    });

    it('prefixes every line when the upstream reply is malformed', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response('not json', { status: 200 }),
      );

      await expect(service.deploy('2e65d5fa87a0499f', 'rev_15')).rejects.toThrow(
        /invalid response/,
      );

      expect(lines.join('\n')).toContain(
        '[deploy] App-builder returned malformed JSON',
      );
      expectEveryLinePrefixed();
    });
  });
});

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
