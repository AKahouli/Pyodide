import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { DerivedFieldPreviewDto, ExpectedModelRevisionDto, SaveDerivedSourceDto } from '../dto';
import { SemanticDerivedSourceService } from '../services/semantic-derived-source.service';

@ApiTags('Semantic Models')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('semantic-models')
export class SemanticDerivedSourceController {
  constructor(private readonly derivedSources: SemanticDerivedSourceService) {}

  @Get(':modelId/derived-sources')
  @ApiOperation({ summary: 'Concepts filled from the records of another concept' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ, Permissions.SEMANTIC_MODELS_ALL], 'any')
  list(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string) {
    return this.derivedSources.list(user._id.toString(), modelId);
  }

  @Post(':modelId/derived-sources')
  @ApiOperation({ summary: 'Fill a concept with one record per distinct key value of another concept' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  create(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Body() dto: SaveDerivedSourceDto) {
    return this.derivedSources.save(user._id.toString(), modelId, dto);
  }

  @Post(':modelId/derived-sources/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read the fields of a concept filled from another one on a few of its records' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  preview(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Body() dto: DerivedFieldPreviewDto) {
    return this.derivedSources.previewFields(user._id.toString(), modelId, dto);
  }

  @Put(':modelId/derived-sources/:derivedSourceId')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  update(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Param('derivedSourceId') derivedSourceId: string,
    @Body() dto: SaveDerivedSourceDto) {
    return this.derivedSources.save(user._id.toString(), modelId, dto, derivedSourceId);
  }

  @Delete(':modelId/derived-sources/:derivedSourceId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([Permissions.SEMANTIC_MODELS_UPDATE, Permissions.SEMANTIC_MODELS_ALL], 'any')
  delete(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Param('derivedSourceId') derivedSourceId: string,
    @Body() dto: ExpectedModelRevisionDto) {
    return this.derivedSources.delete(user._id.toString(), modelId, derivedSourceId, dto.expectedRevision);
  }
}
