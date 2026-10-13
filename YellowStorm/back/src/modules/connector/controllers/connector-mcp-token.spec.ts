import 'reflect-metadata';
import { ConnectorController } from '../connector.controller';
import { ConnectorInternalController } from './connector-internal.controller';
import { InternalServiceGuard } from '../../auth/guards/internal-service.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectorService } from '../connector.service';
import { ConnectorCredentialService } from '../connector-credential.service';
import { ConnectorTransferService } from '../connector-transfer.service';
import { ConnectorUserService } from '../connector-user.service';
import { ConnectedAppOAuthService } from '../../connected-app/services/connected-app-oauth.service';
import { SemanticModelMcpJwtService } from '../services/semantic-model-mcp-jwt.service';

describe('MCP JWT endpoints', () => {
  const url = 'http://localhost:8027/mcp';
  const connectors = { findById: jest.fn() };
  const jwt = { issue: jest.fn() };
  const internal = new ConnectorInternalController({} as never, connectors as never, jwt as never);
  const publicController = new ConnectorController(connectors as never, {} as never, {} as never, {} as never, {} as never, jwt as never);

  beforeEach(() => {
    connectors.findById.mockReset().mockResolvedValue({ isActive: true, mcpTransportType: 'streamable_http', mcpServerUrl: url });
    jwt.issue.mockReset().mockResolvedValue({ token: 'jwt', expiresAt: 123, serverUrl: url });
  });

  it('keeps public issuance behind JWT auth and runtime renewal behind internal auth', () => {
    expect(Reflect.getMetadata('__guards__', ConnectorController)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata('__guards__', ConnectorInternalController)).toContain(InternalServiceGuard);
  });

  it('routes internal renewal to the internal guard rather than the public login guard', async () => {
    // Match production controller order: a dynamic public route previously shadowed renewal.
    const module = await Test.createTestingModule({
      controllers: [ConnectorController, ConnectorInternalController],
      providers: [
        { provide: ConnectorService, useValue: connectors },
        { provide: SemanticModelMcpJwtService, useValue: jwt },
        { provide: ConfigService, useValue: new ConfigService({ INTERNAL_SERVICE_SECRET: 'internal-secret' }) },
        ...[ConnectorCredentialService, ConnectorTransferService, ConnectorUserService, ConnectedAppOAuthService]
          .map((provide) => ({ provide, useValue: {} })),
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => false }).compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const response = await fetch(`${await app.getUrl()}/connectors/internal/mcp-token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Token': 'internal-secret' },
        body: JSON.stringify({ connectorId: 'connector-1', userId: 'acting-user' }),
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ token: 'jwt', expiresAt: 123, serverUrl: url });
    } finally { await app.close(); }
  });

  it('uses the authenticated user for public issuance', async () => {
    await publicController.issueMcpToken('connector-1', { _id: { toString: () => 'acting-user' } } as never);
    expect(jwt.issue).toHaveBeenCalledWith(url, 'acting-user');
  });

  it('renews on behalf of the user supplied by the trusted runtime', async () => {
    await internal.issueMcpToken({ connectorId: 'connector-1', userId: 'acting-user' });
    expect(jwt.issue).toHaveBeenCalledWith(url, 'acting-user');
  });

  it.each([{ isActive: false, mcpTransportType: 'streamable_http' }, { isActive: true, mcpTransportType: 'stdio' }])('rejects inactive or unsupported connectors', async (connector) => {
    connectors.findById.mockResolvedValue({ ...connector, mcpServerUrl: url });
    await expect(internal.issueMcpToken({ connectorId: 'connector-1', userId: 'acting-user' })).rejects.toThrow();
    await expect(publicController.issueMcpToken('connector-1', { _id: { toString: () => 'acting-user' } } as never)).rejects.toThrow();
    expect(jwt.issue).not.toHaveBeenCalled();
  });
});
