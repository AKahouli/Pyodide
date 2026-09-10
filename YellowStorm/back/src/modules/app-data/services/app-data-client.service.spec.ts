import { ConfigService } from '@nestjs/config';
import { AppDataClientService } from './app-data-client.service';
import { RemoteAppDataDeploymentService } from './remote-app-data-deployment.service';
import { RemoteAppDataReleaseBindingService } from './remote-app-data-release-binding.service';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';

function fetchMock(status: number, body: unknown, ok = status < 400): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

function clientWith(fetchImpl: jest.Mock, overrides: Record<string, unknown> = {}) {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        'appData.remote': true,
        'appData.serviceUrl': 'http://app-data:8443',
        'appData.serviceToken': 'test-service-token',
        'appData.remoteTimeoutMs': 5_000,
        'appData.remoteBindTimeoutMs': 10_000,
        'appData.remotePublicBaseUrl': 'http://localhost:8443',
        ...overrides,
      };
      return values[key];
    }),
  };
  const client = new AppDataClientService(config as unknown as ConfigService);
  jest.spyOn(global, 'fetch').mockImplementation(fetchImpl as unknown as typeof fetch);
  return client;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AppDataClientService', () => {
  it('returns null on 404 for getAppByWorkspace', async () => {
    const client = clientWith(fetchMock(404, { message: 'App not found' }));
    await expect(client.getAppByWorkspace('ws-1')).resolves.toBeNull();
  });

  it('maps 404 to NOT_PROVISIONED for bindRelease', async () => {
    const client = clientWith(fetchMock(404, { message: 'App not found for workspace' }));
    await expect(client.bindRelease('ws-1', 'rev-1')).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.NOT_PROVISIONED,
    });
  });

  it('maps network failure to REMOTE_UNAVAILABLE', async () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'appData.serviceUrl' ? 'http://app-data:8443' : undefined,
      ),
    };
    const client = new AppDataClientService(config as unknown as ConfigService);
    jest.spyOn(global, 'fetch').mockImplementation(
      jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch,
    );
    await expect(client.bindRelease('ws-1', 'rev-1')).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.REMOTE_UNAVAILABLE,
    });
  });

  it('sends the service token as bearer authorization', async () => {
    const fetchImpl = fetchMock(200, { id: 'app-1', workspaceId: 'ws-1' });
    const client = clientWith(fetchImpl);
    await client.getAppByWorkspace('ws-1');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-service-token',
    );
  });

  it('passthrough forward keeps upstream status without throwing', async () => {
    const client = clientWith(fetchMock(401, { message: 'Invalid token' }));
    const res = await client.forward('GET', '/v1/apps/app-1/dev/tables/notes/rows', {});
    expect(res.status).toBe(401);
  });
});

describe('RemoteAppDataDeploymentService', () => {
  function serviceWith(fetchImpl: jest.Mock) {
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'appData.enabled': true,
          'appData.remotePublicBaseUrl': 'http://localhost:8443',
        };
        return values[key];
      }),
    };
    const client = clientWith(fetchImpl);
    return new RemoteAppDataDeploymentService(config as unknown as ConfigService, client);
  }

  it('builds runtime env against the remote public base URL', () => {
    const service = serviceWith(fetchMock(200, {}));
    expect(service.resolvePublicUrl('abcd1234', 'dev')).toBe(
      'http://localhost:8443/v1/apps/abcd1234/dev',
    );
    expect(service.buildRuntimeEnv('abcd1234', 'prod')).toEqual({
      appDataId: 'abcd1234',
      environment: 'prod',
      publicUrl: 'http://localhost:8443/v1/apps/abcd1234/prod',
    });
  });

  it('getRuntimeEnvForWorkspace returns null when app is missing', async () => {
    const service = serviceWith(fetchMock(404, { message: 'App not found' }));
    await expect(service.getRuntimeEnvForWorkspace('ws-1', 'dev')).resolves.toBeNull();
  });

  it('prepareProduction binds the release and returns PROD env', async () => {
    const service = serviceWith(
      fetchMock(200, {
        publicUrl: 'http://localhost:8443/v1/apps/app-1/prod',
        appDataId: 'app-1',
        environment: 'prod',
      }),
    );
    await expect(service.prepareProduction('ws-1', 'rev-1')).resolves.toEqual({
      appDataId: 'app-1',
      environment: 'prod',
      publicUrl: 'http://localhost:8443/v1/apps/app-1/prod',
    });
  });
});

describe('RemoteAppDataReleaseBindingService', () => {
  it('bindRevision swallows NOT_PROVISIONED as a no-op', async () => {
    const client = {
      bindRelease: jest.fn().mockRejectedValue(
        new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'not provisioned', 404),
      ),
    };
    const service = new RemoteAppDataReleaseBindingService(client as never);
    await expect(service.bindRevision({ workspaceId: 'ws-1', revisionId: 'rev-1' })).resolves.toEqual(
      { requiredSchemaVersion: null },
    );
  });

  it('bindRevision rethrows unexpected errors', async () => {
    const client = {
      bindRelease: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const service = new RemoteAppDataReleaseBindingService(client as never);
    await expect(service.bindRevision({ workspaceId: 'ws-1', revisionId: 'rev-1' })).rejects.toThrow(
      'boom',
    );
  });

  it('bindRevision reports success without a local schema version', async () => {
    const client = { bindRelease: jest.fn().mockResolvedValue({ appDataId: 'app-1' }) };
    const service = new RemoteAppDataReleaseBindingService(client as never);
    await expect(service.bindRevision({ workspaceId: 'ws-1', revisionId: 'rev-1' })).resolves.toEqual(
      { requiredSchemaVersion: null },
    );
  });
});
