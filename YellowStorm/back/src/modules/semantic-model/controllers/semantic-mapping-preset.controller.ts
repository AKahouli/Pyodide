import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { RateLimit } from '@modules/rate-limiter';
import { MappingPresetQueryDto, SaveMappingPresetDto } from '../dto';
import { SemanticMappingPresetService } from '../services/semantic-mapping-preset.service';

@ApiTags('Semantic Models')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('semantic-models')
export class SemanticMappingPresetController {
  constructor(private readonly presets: SemanticMappingPresetService) {}

  @Get(':modelId/mapping-presets')
  @ApiOperation({ summary: 'Saved settings for reading a concept from documents' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ, Permissions.SEMANTIC_MODELS_ALL], 'any')
  list(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Query() query: MappingPresetQueryDto) {
    return this.presets.list(user._id.toString(), modelId, query.conceptId);
  }

  @Get(':modelId/mapping-presets/last-used')
  @ApiOperation({ summary: 'The settings of the document mapping of a concept saved most recently' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  async lastUsed(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Query() query: MappingPresetQueryDto) {
    return { lastUsed: await this.presets.lastDocumentMapping(user._id.toString(), modelId, query.conceptId) };
  }

  @Post(':modelId/mapping-presets')
  @ApiOperation({ summary: 'Save the current document mapping settings as a named preset' })
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'semantic-model:mapping-presets' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  create(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Body() dto: SaveMappingPresetDto) {
    return this.presets.save(user._id.toString(), modelId, dto);
  }

  @Put(':modelId/mapping-presets/:presetId')
  @ApiOperation({ summary: 'Rename a preset or replace its settings' })
  @RateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'semantic-model:mapping-presets' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  update(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Param('presetId', ParseUUIDPipe) presetId: string, @Body() dto: SaveMappingPresetDto) {
    return this.presets.save(user._id.toString(), modelId, dto, presetId);
  }

  @Delete(':modelId/mapping-presets/:presetId')
  @ApiOperation({ summary: 'Delete a preset; mappings made from it are kept' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  delete(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Param('presetId', ParseUUIDPipe) presetId: string) {
    return this.presets.delete(user._id.toString(), modelId, presetId);
  }
}
