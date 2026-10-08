import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { RateLimit } from '@modules/rate-limiter';
import { CreateDataConnectionDto, UpdateDataConnectionDto } from '../dto';
import { SemanticDataConnectionService } from '../services/semantic-data-connection.service';

@ApiTags('Semantic Models')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('semantic-models')
export class SemanticDataConnectionController {
  constructor(private readonly connections: SemanticDataConnectionService) {}

  @Get(':modelId/data-connections')
  @ApiOperation({ summary: 'The data sources the model reads from' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ, Permissions.SEMANTIC_MODELS_ALL], 'any')
  list(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string) {
    return this.connections.list(user._id, modelId);
  }

  @Post(':modelId/data-connections')
  @ApiOperation({ summary: 'Connect the model to a data source (a mail archive file for now)' })
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'semantic-model:data-connections' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  create(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Body() dto: CreateDataConnectionDto) {
    return this.connections.create(user._id, modelId, dto);
  }

  @Patch(':modelId/data-connections/:connectionId')
  @ApiOperation({ summary: 'Choose whether the data source is also indexed in its workspace' })
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'semantic-model:data-connections' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  update(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string, @Body() dto: UpdateDataConnectionDto) {
    return this.connections.update(user._id, modelId, connectionId, dto);
  }

  @Delete(':modelId/data-connections/:connectionId')
  @ApiOperation({ summary: 'Remove a data source; mappings made from it are kept' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  delete(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Param('connectionId', ParseUUIDPipe) connectionId: string) {
    return this.connections.delete(user._id, modelId, connectionId);
  }
}
