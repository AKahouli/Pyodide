import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import {
  ConnectorActionSafety,
  ConnectorAuthSourceType,
  ConnectorAuthType,
  McpTransportType,
} from './schemas/connector.schema';
import { ConnectorService } from './connector.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorTransferService } from './connector-transfer.service';
import { LoggerService } from '../logger';

const SLUG = 'workspace-bridge';
const SYSTEM_USER_ID = '000000000000000000000000';

const SEED_ACTIONS = [
  {
    key: 'import_connector_item_to_workspace',
    label: 'Import Connector File to Workspace',
    description: 'Import a file from a remote connector (M365, GDrive, etc.) into the current workspace. Use after searching/browsing connector documents when you need the file for processing.',
    parameterSchema: {
      type: 'object',
      properties: {
        connector_id: { type: 'string', description: 'Connector ID to import from' },
        item_ref: { type: 'object', description: 'Item reference from connector search/browse results (e.g. {driveId, itemId})' },
        workspace_id: { type: 'string', description: 'Target workspace ID' },
        filename: { type: 'string', description: 'Optional override filename' },
      },
      required: ['connector_id', 'item_ref', 'workspace_id'],
    },
    outputSchema: {},
    safety: ConnectorActionSafety.WRITE,
    supportsBatch: false,
    supportsIteration: false,
    isEnabled: true,
  },
  {
    key: 'export_workspace_file_to_connector',
    label: 'Export Workspace File to Connector',
    description: 'Export a workspace document to a remote connector (M365, GDrive, etc.). Saves processed results back to SharePoint, OneDrive, or Google Drive.',
    parameterSchema: {
      type: 'object',
      properties: {
        connector_id: { type: 'string', description: 'Connector ID to export to' },
        target_ref: { type: 'object', description: 'Target location (e.g. {driveId, path} for create, {driveId, itemId} for update)' },
        workspace_id: { type: 'string', description: 'Workspace ID containing the source document' },
        document_id: { type: 'string', description: 'Workspace document ID to export' },
        mode: { type: 'string', enum: ['create', 'update'], default: 'create', description: "'create' = new file, 'update' = replace existing" },
        filename: { type: 'string', description: 'Filename for new file (create mode only)' },
      },
      required: ['connector_id', 'target_ref', 'workspace_id', 'document_id'],
    },
    outputSchema: {},
    safety: ConnectorActionSafety.WRITE,
    supportsBatch: false,
    supportsIteration: false,
    isEnabled: true,
  },
];

@Injectable()
export class WorkspaceBridgeService {
  private mcpServer: McpServer | null = null;
  private transport: StreamableHTTPServerTransport | null = null;
  private validatedToken: string | null = null;
  private readonly logger = new Logger(WorkspaceBridgeService.name);

  constructor(
    private readonly connectorService: ConnectorService,
    private readonly credentialService: ConnectorCredentialService,
    private readonly transferService: ConnectorTransferService,
    private readonly configService: ConfigService,
    private readonly loggerService: LoggerService,
  ) {}

  get handler() {
    return (req: any, res: any) => {
      if (!this.transport) {
        res.writeHead(503);
        res.end('MCP server not initialized');
        return;
      }

      const method = req.body?.method as string | undefined;
      const isDiscoveryMethod =
        method === 'initialize' ||
        method === 'notifications/initialized' ||
        method === 'tools/list';

      const auth = (req.headers['authorization'] || '') as string;
      if (!isDiscoveryMethod && (!auth.startsWith('Bearer ') || auth.slice(7) !== this.validatedToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing bearer token' }));
        return;
      }

      this.transport.handleRequest(req, res);
    };
  }

  async init() {
    this.loggerService.setContext(WorkspaceBridgeService.name);

    await this.seedConnector();

    this.mcpServer = new McpServer(
      { name: 'Workspace Bridge', version: '1.0.0' },
      {
        instructions: [
          'Transfer files between remote connectors (M365, GDrive) and the current workspace.',
          'Use import_connector_item_to_workspace to download a connector file into the workspace.',
          'Use export_workspace_file_to_connector to upload a workspace document to a connector.',
        ].join('\n'),
      },
    );

    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    this.mcpServer.tool(
      'import_connector_item_to_workspace',
      SEED_ACTIONS[0].description,
      {
        connector_id: z.string().describe('Connector ID to import from'),
        item_ref: z.record(z.string(), z.unknown()).describe('Item reference from connector search/browse results (e.g. {driveId, itemId})'),
        workspace_id: z.string().describe('Target workspace ID'),
        filename: z.string().optional().describe('Optional override filename'),
      },
      async ({ connector_id, item_ref, workspace_id, filename }) => {
        try {
          const result = await this.transferService.importToWorkspace(
            '', connector_id, item_ref, workspace_id, { filename },
          );
          if (!result.success) {
            return { content: [{ type: 'text' as const, text: `Import failed: ${result.error}` }] };
          }
          return {
            content: [{
              type: 'text' as const,
              text: [
                'File imported successfully to workspace.',
                `  Document ID: ${result.workspaceDocumentId}`,
                `  Filename: ${result.filename}`,
                `  Size: ${result.size} bytes`,
              ].join('\n'),
            }],
          };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }] };
        }
      },
    );

    this.mcpServer.tool(
      'export_workspace_file_to_connector',
      SEED_ACTIONS[1].description,
      {
        connector_id: z.string().describe('Connector ID to export to'),
        target_ref: z.record(z.string(), z.unknown()).describe('Target location (e.g. {driveId, path} for create, {driveId, itemId} for update)'),
        workspace_id: z.string().describe('Workspace ID containing the source document'),
        document_id: z.string().describe('Workspace document ID to export'),
        mode: z.enum(['create', 'update']).default('create').describe("'create' = new file, 'update' = replace existing"),
        filename: z.string().optional().describe('Filename for new file (create mode only)'),
      },
      async ({ connector_id, target_ref, workspace_id, document_id, mode, filename }) => {
        try {
          const result = await this.transferService.exportFromWorkspace(
            '', connector_id, target_ref, workspace_id, document_id, mode, { filename },
          );
          if (!result.success) {
            return { content: [{ type: 'text' as const, text: `Export failed: ${result.error}` }] };
          }
          const parts = [
            'File exported successfully to connector.',
            `  Item ID: ${result.connectorItemId}`,
            `  Filename: ${result.filename}`,
          ];
          if (result.webUrl) parts.push(`  URL: ${result.webUrl}`);
          return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }] };
        }
      },
    );

    await this.mcpServer.connect(this.transport);
    this.logger.log('Workspace Bridge MCP server initialized');
  }

  private async seedConnector() {
    const port = this.configService.get<number>('PORT', 3000);
    const host = this.configService.get<string>('HOST', 'localhost');
    const serverUrl = `http://${host}:${port}/mcp/workspace-bridge`;

    const existing = await this.connectorService.findBySlug(SLUG);
    if (existing) {
      this.logger.log('Workspace Bridge connector already exists, skipping seed');
      const cred = await this.credentialService.findActiveByConnectorId(existing.id);
      if (cred) {
        this.validatedToken = (cred.authPayload as any)?.token as string;
      }
      if (!this.validatedToken) {
        this.logger.warn('No active credential found for workspace bridge connector');
      }
      return;
    }

    this.logger.log('Auto-seeding Workspace Bridge connector');

    const token = randomBytes(32).toString('hex');
    this.validatedToken = token;

    const connector = await this.connectorService.create(SYSTEM_USER_ID, {
      slug: SLUG,
      name: 'Workspace Bridge',
      description: 'Platform connector for importing/exporting files between remote connectors (M365, GDrive) and the workspace.',
      icon: 'folder-sync',
      color: '#6366f1',
      authType: ConnectorAuthType.TOKEN,
      authSourceType: ConnectorAuthSourceType.CREDENTIAL,
      mcpTransportType: McpTransportType.STREAMABLE_HTTP,
      mcpServerUrl: serverUrl,
      mcpServerConfig: {},
      runtimeAuthConfig: { strategy: 'http_header_bearer' },
      actions: SEED_ACTIONS,
    });

    await this.credentialService.create(SYSTEM_USER_ID, {
      connectorId: connector.id,
      displayName: 'Workspace Bridge Token',
      authPayload: { token },
    });

    this.logger.log('Workspace Bridge connector seeded with credential');
  }

  async close() {
    await this.mcpServer?.close();
    this.mcpServer = null;
    this.transport = null;
  }
}
