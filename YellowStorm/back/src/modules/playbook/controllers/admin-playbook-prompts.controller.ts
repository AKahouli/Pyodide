import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../../authorization/guards/permissions.guard';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { PlaybookPromptService } from '../services/playbook-prompt.service';
import { UpsertPlaybookPromptDto } from '../dto/upsert-playbook-prompt.dto';

@ApiTags('Admin Playbook Prompts')
@ApiBearerAuth()
@Controller('admin/playbook-prompts')
@UseGuards(PermissionsGuard)
export class AdminPlaybookPromptsController {
  constructor(private readonly promptService: PlaybookPromptService) {}

  @Get()
  @RequirePermissions(Permissions.ADMIN_ALL)
  @ApiOperation({ summary: 'List playbook prompt templates' })
  @ApiResponse({ status: 200, description: 'Prompt templates retrieved' })
  async list() {
    return this.promptService.findAll();
  }

  @Get(':key')
  @RequirePermissions(Permissions.ADMIN_ALL)
  @ApiOperation({ summary: 'Get a playbook prompt template by key' })
  async getOne(@Param('key') key: string) {
    return this.promptService.findByKey(decodeURIComponent(key));
  }

  @Patch(':key')
  @RequirePermissions(Permissions.ADMIN_ALL)
  @ApiOperation({ summary: 'Update a playbook prompt template' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpsertPlaybookPromptDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.promptService.upsert(decodeURIComponent(key), dto, user._id.toString());
  }
}
