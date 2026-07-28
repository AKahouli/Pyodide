import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '@modules/authorization/constants/permissions';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { UpdateEvaluationSettingsDto } from '../dto/update-evaluation-settings.dto';
import { EvaluationSettingsService } from '../services/evaluation-settings.service';

@ApiTags('Admin Evaluation Settings')
@ApiBearerAuth()
@Controller('admin/evaluation-settings')
@UseGuards(PermissionsGuard)
export class AdminEvaluationSettingsController {
  constructor(private readonly settingsService: EvaluationSettingsService) {}

  @Get()
  @RequirePermissions(Permissions.ADMIN_ALL)
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Put()
  @RequirePermissions(Permissions.ADMIN_ALL)
  updateSettings(@Body() input: UpdateEvaluationSettingsDto) {
    return this.settingsService.updateSettings(input);
  }
}
