import { Controller, Get, Patch, Delete, Param, Body, UseGuards, NotFoundException, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { PlaybookFlowPromptTemplateService } from '../services/playbook-flow-prompt-template.service';
import { UpsertFlowPromptTemplateDto } from '../dto/upsert-flow-prompt-template.dto';
import { ImportFlowPromptTemplatesDto } from '../dto/import-flow-prompt-templates.dto';

@ApiTags('Admin Playbook Prompts')
@ApiBearerAuth()
@Controller('admin/playbook-prompts')
@UseGuards(PermissionsGuard)
export class PlaybookFlowPromptTemplateController {
  constructor(
    private readonly promptService: PlaybookFlowPromptTemplateService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all playbook prompt templates' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findAll() {
    return this.promptService.findAll();
  }

  @Put('import')
  @ApiOperation({ summary: 'Replace all playbook prompt templates from an import payload' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async replaceAll(
    @CurrentUser() user: { _id: string },
    @Body() body: ImportFlowPromptTemplatesDto,
  ) {
    return this.promptService.replaceAll(body, user._id);
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a prompt template by key' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findByKey(@Param('key') key: string) {
    const result = await this.promptService.findByKey(decodeURIComponent(key));
    if (!result) throw new NotFoundException(`Prompt template "${key}" not found`);
    return result;
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Upsert a prompt template by key' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async upsert(
    @Param('key') key: string,
    @CurrentUser() user: { _id: string },
    @Body() body: UpsertFlowPromptTemplateDto,
  ) {
    return this.promptService.upsert(decodeURIComponent(key), body, user._id);
  }

  @Delete(':key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a non-built-in prompt template' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async remove(@Param('key') key: string) {
    const deleted = await this.promptService.remove(decodeURIComponent(key));
    if (!deleted) throw new NotFoundException(`Prompt template "${key}" not found`);
    return { success: true };
  }
}
