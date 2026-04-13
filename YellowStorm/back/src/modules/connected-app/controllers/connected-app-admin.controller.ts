import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
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

  @Get(':id')
  @RequirePermissions(
    [Permissions.CONNECTED_APPS_READ, Permissions.CONNECTED_APPS_ALL],
    'any',
  )
  @ApiOperation({ summary: 'Get connected app definition by ID (admin)' })
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
