import 'reflect-metadata';
import { ConnectorController } from '../connector.controller';
import { ConnectorInternalController } from './connector-internal.controller';
import { AdkNativeActorGuard } from '../../auth/guards/adk-native-actor.guard';
import { AdkRuntimeMcpRenewalGuard } from '../../auth/guards/internal-service-principal.guard';
import { ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectorService } from '../connector.service';
import { ConnectorCredentialService } from '../connector-credential.service';
import { ConnectorTransferService } from '../connector-transfer.service';
import { ConnectorUserService } from '../connector-user.service';
import { ConnectedAppOAuthService } from '../../connected-app/services/connected-app-oauth.service';
import { McpJwtService } from '../services/mcp-jwt.service';

describe('MCP JWT endpoints', () => {
  const url = 'http://localhost:8027/mcp';
  const connectors = { findById: jest.fn(), getRuntimeById: jest.fn() };
  const jwt = { issue: jest.fn(), renew: jest.fn() };
  const internal = new ConnectorInternalController({} as never, connectors as never, jwt as never);
  const publicController = new ConnectorController(connectors as never, {} as never, {} as never, {} as never, {} as never, jwt as never);

  beforeEach(() => {
    connectors.findById.mockReset().mockResolvedValue({ isActive: true, mcpTransportType: 'streamable_http', mcpServerUrl: url });
    connectors.getRuntimeById.mockReset().mockResolvedValue({ id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http', mcpServerUrl: url });
    jwt.issue.mockReset().mockResolvedValue({ token: 'jwt', expiresAt: 123, serverUrl: url });
    jwt.renew.mockReset().mockResolvedValue({ token: 'jwt', expiresAt: 123, serverUrl: url });
  });

  it('keeps user issuance behind login and renewal behind the dedicated runtime principal', () => {
    expect(Reflect.getMetadata('__guards__', ConnectorController)).toContain(JwtAuthGuard);
    // Renewal and native transfer have separate machine/execution authority.
    const tokenGuards = Reflect.getMetadata('__guards__', ConnectorInternalController.prototype.issueMcpToken) as unknown[];
    const importGuards = Reflect.getMetadata('__guards__', ConnectorInternalController.prototype.importFromConnector) as unknown[];
    expect(tokenGuards).toContain(AdkRuntimeMcpRenewalGuard);
    expect(importGuards).toContain(AdkNativeActorGuard);
  });

  it('routes internal renewal to the scoped principal rather than the public login guard', async () => {
    // Match production controller order: a dynamic public route previously shadowed renewal.
    const module = await Test.createTestingModule({
      controllers: [ConnectorController, ConnectorInternalController],
      providers: [
        { provide: ConnectorService, useValue: connectors },
        { provide: McpJwtService, useValue: jwt },
        { provide: ConfigService, useValue: new ConfigService({ ADK_RUNTIME_MCP_RENEWAL_TOKEN: 'runtime-principal-test-secret' }) },
        ...[ConnectorCredentialService, ConnectorTransferService, ConnectorUserService, ConnectedAppOAuthService]
          .map((provide) => ({ provide, useValue: {} })),
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => false }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    try {
      await app.listen(0, '127.0.0.1');
      const renewalUrl = `${await app.getUrl()}/connectors/internal/mcp-token`;
      const principalHeaders = {
        'Content-Type': 'application/json',
        'X-Yellowstorm-Service-Principal': 'adk-runtime',
        'X-Yellowstorm-Service-Token': 'runtime-principal-test-secret',
      };
      const response = await fetch(renewalUrl, {
        method: 'POST', headers: principalHeaders,
        body: JSON.stringify({ connectorId: 'connector-1', assertion: 'current-signed-proof' }),
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ token: 'jwt', expiresAt: 123, serverUrl: url });

      // The legacy shared internal secret and a foreign principal can no
      // longer mint MCP JWTs (WP07.3/WP07.4).
      const deniedHeaderSets: Record<string, string>[] = [
        { 'Content-Type': 'application/json', 'X-Internal-Token': 'anything' },
        { ...principalHeaders, 'X-Yellowstorm-Service-Principal': 'app-runtime' },
        { ...principalHeaders, 'X-Yellowstorm-Service-Principal': 'semantic-model-mcp' },
      ];
      for (const headers of deniedHeaderSets) {
        const denied = await fetch(renewalUrl, {
          method: 'POST', headers,
          body: JSON.stringify({ connectorId: 'connector-1', userId: 'acting-user' }),
        });
        expect(denied.status).toBe(401);
      }
      const userOnly = await fetch(renewalUrl, { method: 'POST', headers: principalHeaders,
        body: JSON.stringify({ connectorId: 'connector-1', userId: 'other-user' }) });
      expect(userOnly.status).toBe(400);
      expect(jwt.renew).toHaveBeenCalledTimes(1);
      expect(jwt.renew).toHaveBeenCalledWith('connector-1', 'current-signed-proof');
      expect(jwt.issue).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('uses the authenticated user for public issuance', async () => {
    await publicController.issueMcpToken('connector-1', { _id: { toString: () => 'acting-user' } } as never);
    expect(jwt.issue).toHaveBeenCalledWith('connector-1', 'acting-user');
  });

  it('passes existing proof instead of a caller-selected subject to renewal', async () => {
    await internal.issueMcpToken({ connectorId: 'connector-1', assertion: 'current-signed-proof' });
    expect(jwt.renew).toHaveBeenCalledWith('connector-1', 'current-signed-proof');
  });

  it.each([{ isActive: false, mcpTransportType: 'streamable_http' }, { isActive: true, mcpTransportType: 'stdio' }])('rejects inactive or unsupported connectors', async (connector) => {
    connectors.findById.mockResolvedValue({ ...connector, mcpServerUrl: url });
    connectors.getRuntimeById.mockResolvedValue({ ...connector, mcpServerUrl: url });
    await expect(publicController.issueMcpToken('connector-1', { _id: { toString: () => 'acting-user' } } as never)).rejects.toThrow();
    expect(jwt.issue).not.toHaveBeenCalled();
  });
});
