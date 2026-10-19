import { AgentModule } from './agent.module';
import { ConnectorModule } from '@modules/connector/connector.module';
import { McpJwtService } from '@modules/connector/services/mcp-jwt.service';

/**
 * DB-free wiring guard: AgentModule must consume ConnectorModule's exported
 * McpJwtService and must not shadow it with a local provider. A local instance
 * lacks WorkspaceShareService (an @Optional() dependency of McpJwtService),
 * which made agent-runtime issuance with workspaceAuthorization deny with
 * "Invalid MCP authorization".
 */
describe('AgentModule wiring', () => {
  it('imports ConnectorModule so the exported McpJwtService is visible', () => {
    const imports = Reflect.getMetadata('imports', AgentModule) as unknown[];
    expect(imports).toContain(ConnectorModule);
  });

  it('does not re-provide McpJwtService locally', () => {
    const providers = Reflect.getMetadata('providers', AgentModule) as unknown[];
    expect(providers).not.toContain(McpJwtService);
  });
});
