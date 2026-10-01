import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConnectorService } from '../connector.service';

/**
 * Seeds the hidden `semantic-model-search-mcp` system connector (record search
 * tools served by the mcp-semantic-model MCP server over Streamable HTTP) once
 * per boot. Idempotent; admin edits to the connector are preserved. Skipped when
 * SEMANTIC_MODEL_MCP_SERVER_URL is empty.
 */
@Injectable()
export class SemanticModelSearchMcpConnectorBootstrapService implements OnModuleInit {
  constructor(private readonly connectorService: ConnectorService) {}

  async onModuleInit(): Promise<void> {
    await this.connectorService.ensureSystemSemanticModelSearchMcpConnector();
  }
}
