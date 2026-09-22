import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConnectorService } from '../connector.service';

/**
 * Seeds the hidden `agent-mcp` system connector (agent/team CRUD served by
 * the mcp-agent MCP server over Streamable HTTP) once per boot. Idempotent;
 * admin edits to the connector are preserved.
 */
@Injectable()
export class AgentMcpConnectorBootstrapService implements OnModuleInit {
  constructor(private readonly connectorService: ConnectorService) {}

  async onModuleInit(): Promise<void> {
    await this.connectorService.ensureSystemAgentMcpConnector();
  }
}
