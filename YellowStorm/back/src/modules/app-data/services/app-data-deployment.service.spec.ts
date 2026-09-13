import { ConfigService } from '@nestjs/config';
import { AppDataDeploymentService } from './app-data-deployment.service';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';

function serviceWith(overrides: Record<string, unknown> = {}): AppDataDeploymentService {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        'appData.remotePublicBaseUrl': 'http://localhost:8443',
        ...overrides,
      };
      return values[key];
    }),
  };
  return new AppDataDeploymentService(
    config as unknown as ConfigService,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AppDataDeploymentService', () => {
  it('builds dev URLs against the microservice public base', () => {
    const service = serviceWith();
    expect(service.resolvePublicUrl('abcd1234', 'dev')).toBe(
      'http://localhost:8443/v1/apps/abcd1234/dev',
    );
  });

  it('never emits the obsolete monolith /api/v1/app-data/public path', () => {
    const service = serviceWith();
    for (const environment of ['dev', 'prod'] as const) {
      expect(service.resolvePublicUrl('abcd1234', environment)).not.toContain(
        '/api/v1/app-data/public/',
      );
    }
  });

  it('defaults the dev base to the local microservice when unset', () => {
    const service = serviceWith({ 'appData.remotePublicBaseUrl': '' });
    expect(service.resolvePublicUrl('abcd1234', 'dev')).toBe(
      'http://localhost:8443/v1/apps/abcd1234/dev',
    );
  });

  it('builds prod URLs against the dedicated public prod base', () => {
    const service = serviceWith({
      'appData.remotePublicBaseUrlProd': 'https://apps.yellowsys.org/',
    });
    expect(service.resolvePublicUrl('abcd1234', 'prod')).toBe(
      'https://apps.yellowsys.org/v1/apps/abcd1234/prod',
    );
  });

  it('falls back to the dev base for prod deploys in non-prod environments', () => {
    const service = serviceWith({ 'appData.remotePublicBaseUrlProd': '' });
    expect(service.resolvePublicUrl('abcd1234', 'prod')).toBe(
      'http://localhost:8443/v1/apps/abcd1234/prod',
    );
  });

  it('requires a prod public base when deploying in production', () => {
    const service = serviceWith({ 'appData.remotePublicBaseUrlProd': '' });
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => service.resolvePublicUrl('abcd1234', 'prod')).toThrow(
        new AppDataException(
          AppDataErrorCode.DEPLOY_CONFIG_MISSING,
          'APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD is required when deploying App Data apps in production',
        ),
      );
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  });

  it('buildRuntimeEnv carries the microservice public URL', () => {
    const service = serviceWith();
    expect(service.buildRuntimeEnv('abcd1234', 'dev')).toEqual({
      appDataId: 'abcd1234',
      environment: 'dev',
      publicUrl: 'http://localhost:8443/v1/apps/abcd1234/dev',
    });
  });
});