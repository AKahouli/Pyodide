import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { Permissions } from '@modules/authorization/constants/permissions';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowSettingsService } from '../services/playbook-flow-settings.service';
import { UpdateAdminPlaybookSettingsDto } from '../dto/update-admin-playbook-settings.dto';

@ApiTags('Admin Playbook Settings')
@ApiBearerAuth()
@Controller('admin/playbook-settings')
@UseGuards(PermissionsGuard)
export class PlaybookFlowSettingsController {
  constructor(
    private readonly settingsService: PlaybookFlowSettingsService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaybookFlowSettingsController.name);
  }

  @Get()
  @ApiOperation({ summary: 'Get admin playbook settings' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getSettings() {
    return this.settingsService.getAdminSettings();
  }

  @Get('planner-agents')
  @ApiOperation({ summary: 'List eligible Dynamic Reasoning planner agents' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async listPlannerAgents() {
    return this.settingsService.listPlannerAgents();
  }

  @Post()
  @ApiOperation({ summary: 'Update admin playbook settings' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async updateSettings(
    @CurrentUser('_id') userId: string,
    @Body() body: UpdateAdminPlaybookSettingsDto,
  ) {
    const result = await this.settingsService.updateAdminSettings(body);
    this.logger.log('Admin playbook settings updated', {
      userId,
      updatedFields: Object.keys(body),
    });
    return result;
  }
}
