import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '@modules/authorization/constants/permissions';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { UpdateGuardrailsSettingsDto } from '../dto/guardrails-settings.dto';
import { GuardrailsSettingsService } from '../services/guardrails-settings.service';

@ApiTags('Admin Guardrails')
@ApiBearerAuth()
@Controller('admin/guardrails')
@UseGuards(PermissionsGuard)
export class AdminGuardrailsController {
  constructor(private readonly settingsService: GuardrailsSettingsService) {}

  @Get()
  @RequirePermissions(Permissions.ADMIN_ALL)
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Put()
  @RequirePermissions(Permissions.ADMIN_ALL)
  updateSettings(@Body() dto: UpdateGuardrailsSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }
}
