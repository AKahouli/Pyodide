import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { AiExtractionSettingsDto, RunLimitsDto } from '../dto/semantic-model.dto';
import { SemanticExtractionSettingsService } from '../services/semantic-extraction-settings.service';

@ApiTags('Semantic Model Settings')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller()
export class SemanticExtractionSettingsController {
  constructor(private readonly settings: SemanticExtractionSettingsService) {}

  @Get('admin/semantic-model-settings')
  @ApiOperation({ summary: 'How much of a document the AI reads, for every model' })
  @RequirePermissions(Permissions.ADMIN_ALL)
  getAdminSettings() {
    return this.settings.getDefaults();
  }

  @Put('admin/semantic-model-settings')
  @RequirePermissions(Permissions.ADMIN_ALL)
  updateAdminSettings(@CurrentUser() user: AuthUser, @Body() input: AiExtractionSettingsDto) {
    return this.settings.updateDefaults(user._id.toString(), input);
  }

  @Get('admin/semantic-model-settings/run-limits')
  @ApiOperation({ summary: 'How much one population run may read and keep, for every model' })
  @RequirePermissions(Permissions.ADMIN_ALL)
  getRunLimits() {
    return this.settings.getRunLimits();
  }

  @Put('admin/semantic-model-settings/run-limits')
  @RequirePermissions(Permissions.ADMIN_ALL)
  updateRunLimits(@CurrentUser() user: AuthUser, @Body() input: RunLimitsDto) {
    return this.settings.updateRunLimits(user._id.toString(), input);
  }

  @Get('semantic-model-settings/extraction')
  @ApiOperation({ summary: 'The AI reading limits a document mapping starts from' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ, Permissions.SEMANTIC_MODELS_ALL], 'any')
  getExtractionDefaults() {
    return this.settings.getDefaults();
  }
}
