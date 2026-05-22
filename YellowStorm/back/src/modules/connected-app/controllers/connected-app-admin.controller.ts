import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { Permissions } from '@modules/authorization/constants/permissions';
import { ConnectedAppDefinitionService } from '../services/connected-app-definition.service';
import { CreateConnectedAppDefinitionDto } from '../dto/create-connected-app-definition.dto';
import { UpdateConnectedAppDefinitionDto } from '../dto/update-connected-app-definition.dto';

@ApiTags('Admin - Connected Apps')
@ApiBearerAuth()
@Controller('admin/connected-apps')
export class ConnectedAppAdminController {
  constructor(
    private readonly definitionService: ConnectedAppDefinitionService,
  ) {}

  @Get()
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_READ, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'List all connected app definitions (admin)' })
  @ApiResponse({ status: 200, description: 'All app definitions with masked secrets' })
  async findAll() {
    return this.definitionService.findAll();
  }

  @Get('presets')
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_READ, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Get available OAuth provider presets' })
  @ApiResponse({ status: 200, description: 'List of predefined OAuth providers' })
  async getPresets() {
    return this.definitionService.getPresets();
  }

  @Get('validate-appkey')
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_READ, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Validate appKey and check for duplicates' })
  @ApiQuery({ name: 'appKey', required: true, description: 'App key to validate' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  async validateAppKey(@Query('appKey') appKey: string) {
    return this.definitionService.validateAppKey(appKey);
  }

  @Get('suggest-appkey')
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_READ, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Generate appKey suggestion from display name' })
  @ApiQuery({ name: 'displayName', required: true, description: 'Display name to convert to appKey' })
  @ApiResponse({ status: 200, description: 'Suggested appKey' })
  async suggestAppKey(@Query('displayName') displayName: string) {
    const suggestion = await this.definitionService.suggestAppKey(displayName);
    return { appKey: suggestion };
  }

  @Get('callback-url')
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_READ, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Generate callback URL for an appKey' })
  @ApiQuery({ name: 'appKey', required: true, description: 'App key to generate callback URL for' })
  @ApiQuery({ name: 'backendUrl', required: false, description: 'Optional custom backend URL' })
  @ApiResponse({ status: 200, description: 'Generated callback URL' })
  async generateCallbackUrl(
    @Query('appKey') appKey: string,
    @Query('backendUrl') backendUrl?: string,
  ) {
    const callbackUrl = await this.definitionService.generateCallbackUrl(appKey, backendUrl);
    return { callbackUrl };
  }

  @Get(':id')
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_READ, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Get connected app definition by ID (admin)' })
  @ApiParam({ name: 'id', description: 'Connected app ID' })
  @ApiResponse({ status: 200, description: 'App definition details' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id') id: string) {
    return this.definitionService.findById(id);
  }

  @Post()
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_CREATE, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Create connected app definition' })
  @ApiResponse({ status: 201, description: 'App definition created' })
  @ApiResponse({ status: 409, description: 'App key already exists' })
  async create(@Body() dto: CreateConnectedAppDefinitionDto) {
    return this.definitionService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_UPDATE, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Update connected app definition' })
  @ApiParam({ name: 'id', description: 'Connected app ID' })
  @ApiResponse({ status: 200, description: 'App definition updated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConnectedAppDefinitionDto,
  ) {
    return this.definitionService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_DELETE, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Delete connected app definition' })
  @ApiParam({ name: 'id', description: 'Connected app ID' })
  @ApiResponse({ status: 200, description: 'App definition deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async delete(@Param('id') id: string) {
    const result = await this.definitionService.delete(id);
    return {
      message: 'Connected app deleted successfully',
      deletedConnections: result.deletedConnections,
    };
  }
}
