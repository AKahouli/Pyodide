import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import {
  CreateConnectorCredentialDto,
  UpdateConnectorCredentialDto,
} from './dto';
import { ImportConnectorItemDto, ExportToConnectorDto } from './dto/connector-transfer.dto';
import { InspectConnectorDto } from './dto/inspect-connector.dto';
import { IConnectorResponse, IConnectorCredentialResponse } from './interfaces/connector.interface';
import { ConnectorService } from './connector.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorTransferService } from './connector-transfer.service';
import { ConnectorUserService, RepositoryQuery } from './connector-user.service';
import { ConnectedAppOAuthService } from '../connected-app/services/connected-app-oauth.service';
import { RateLimit } from '@modules/rate-limiter';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

@ApiTags('Connectors')
@ApiBearerAuth()
@Controller('connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorController {
  constructor(
    private readonly connectorService: ConnectorService,
    private readonly credentialService: ConnectorCredentialService,
    private readonly transferService: ConnectorTransferService,
    private readonly oauthService: ConnectedAppOAuthService,
    private readonly connectorUserService: ConnectorUserService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List active connectors available for binding' })
  async listActive(): Promise<IConnectorResponse[]> {
    return this.connectorService.findAllActive();
  }

  @Get('repositories')
  @ApiOperation({ summary: 'Get repositories for a connected app (e.g., GitHub repos)' })
  async getRepositories(
    @CurrentUser() user: UserDocument,
    @Query('appKey') appKey: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.connectorUserService.getRepositories(user.id.toString(), appKey, {
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 30,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a connector by ID' })
  @ApiParam({ name: 'id', description: 'Connector ID' })
  async findById(@Param('id') id: string): Promise<IConnectorResponse> {
    return this.connectorService.findById(id);
  }

  // --- Credentials ---

  @Get(':connectorId/credentials')
  @ApiOperation({ summary: 'List credentials for a connector owned by the current user' })
  async listCredentials(
    @Param('connectorId') connectorId: string,
    @CurrentUser() user: UserDocument,
  ): Promise<IConnectorCredentialResponse[]> {
    return this.credentialService.findAllForUser(user._id.toString(), { connectorId });
  }

  @Post(':connectorId/credentials')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a credential for a connector' })
  async createCredential(
    @Param('connectorId') connectorId: string,
    @Body() dto: CreateConnectorCredentialDto,
    @CurrentUser() user: UserDocument,
  ): Promise<IConnectorCredentialResponse> {
    return this.credentialService.create(user._id.toString(), {
      ...dto,
      connectorId,
    });
  }

  @Get('credentials/:id')
  @ApiOperation({ summary: 'Get a credential by ID' })
  @ApiParam({ name: 'id', description: 'Credential ID' })
  async getCredential(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
  ): Promise<IConnectorCredentialResponse> {
    return this.credentialService.findById(id, user._id.toString());
  }

  @Patch('credentials/:id')
  @ApiOperation({ summary: 'Update a credential' })
  @ApiParam({ name: 'id', description: 'Credential ID' })
  async updateCredential(
    @Param('id') id: string,
    @Body() dto: UpdateConnectorCredentialDto,
    @CurrentUser() user: UserDocument,
  ): Promise<IConnectorCredentialResponse> {
    return this.credentialService.update(id, user._id.toString(), dto);
  }

  @Delete('credentials/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a credential' })
  @ApiParam({ name: 'id', description: 'Credential ID' })
  async deleteCredential(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
  ): Promise<void> {
    await this.credentialService.delete(id, user._id.toString());
  }

  @Post('credentials/:id/validate')
  @ApiOperation({ summary: 'Validate a credential (check expiration, refresh if needed)' })
  @ApiParam({ name: 'id', description: 'Credential ID' })
  async validateCredential(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
  ): Promise<IConnectorCredentialResponse> {
    return this.credentialService.validateCredential(id, user._id.toString());
  }

  // --- OAuth ---

  @Get(':id/authorize')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'connector:authorize' })
  @ApiOperation({ summary: 'Get OAuth authorization URL for a connector' })
  @ApiParam({ name: 'id', description: 'Connector ID' })
  async authorizeConnector(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
  ) {
    const connector = await this.connectorService.findById(id);

    if (!connector.connectedAppKey) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Connector does not support OAuth authentication',
      );
    }

    const authorizationUrl = await this.oauthService.buildAuthorizationUrl(
      user._id.toString(),
      connector.connectedAppKey,
    );

    return { authorizationUrl };
  }

  @Post(':id/inspect')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'connector:inspect' })
  @ApiOperation({ summary: 'Inspect MCP server using connector configuration' })
  @ApiParam({ name: 'id', description: 'Connector ID' })
  async inspectConnector(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Body() dto: InspectConnectorDto,
  ) {
    const connector = await this.connectorService.findById(id);

    if (dto.useOAuth && !connector.connectedAppKey) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Connector does not support OAuth authentication',
      );
    }

    return this.connectorService.inspectMcp(
      connector.mcpTransportType,
      connector.mcpServerUrl,
      connector.mcpServerConfig,
      dto.useOAuth ? user._id.toString() : undefined,
      dto.useOAuth ? connector.connectedAppKey : undefined,
    );
  }

  // --- Transfer ---

  @Post('transfer/import')
  @ApiOperation({ summary: 'Import one or more connector items into a workspace' })
  async importFromConnector(
    @Body() dto: ImportConnectorItemDto,
    @CurrentUser() user: UserDocument,
  ): Promise<unknown> {
    return this.transferService.importToWorkspace(
      user._id.toString(),
      dto.connectorId,
      dto.workspaceId,
      {
        mode: dto.mode || 'file',
        itemRef: dto.itemRef,
        itemRefs: dto.itemRefs,
        recursive: dto.recursive ?? true,
        flatten: dto.flatten ?? true,
        filename: dto.filename,
        mimeType: dto.mimeType,
      },
    );
  }

  @Post('transfer/export')
  @ApiOperation({ summary: 'Export a workspace document to a remote connector' })
  async exportToConnector(
    @Body() dto: ExportToConnectorDto,
    @CurrentUser() user: UserDocument,
  ): Promise<unknown> {
    return this.transferService.exportFromWorkspace(
      user._id.toString(),
      dto.connectorId,
      dto.targetRef,
      dto.workspaceId,
      dto.documentId,
      dto.mode || 'create',
      { filename: dto.filename },
    );
  }
}
