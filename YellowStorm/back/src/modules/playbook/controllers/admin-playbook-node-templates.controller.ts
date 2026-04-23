import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../../authorization/guards/permissions.guard';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { PlaybookNodeTemplateService } from '../services/playbook-node-template.service';
import { CreatePlaybookNodeTemplateDto } from '../dto/create-playbook-node-template.dto';
import { UpdatePlaybookNodeTemplateDto } from '../dto/update-playbook-node-template.dto';

@ApiTags('Admin Playbook Node Templates')
@ApiBearerAuth()
@Controller('admin/playbook-node-templates')
@UseGuards(PermissionsGuard)
export class AdminPlaybookNodeTemplatesController {
  constructor(private readonly templateService: PlaybookNodeTemplateService) {}

  @Get()
  @RequirePermissions(Permissions.ADMIN_ALL)
  @ApiOperation({ summary: 'List all playbook node templates' })
  @ApiResponse({ status: 200, description: 'Node templates retrieved' })
  async list() {
    return this.templateService.findAll();
  }

  @Get(':id')
  @RequirePermissions(Permissions.ADMIN_ALL)
  @ApiOperation({ summary: 'Get a playbook node template by id' })
  async getOne(@Param('id') id: string) {
    const template = await this.templateService.findById(id);
    if (!template) {
      return null;
    }
    return template;
  }

  @Post()
  @RequirePermissions(Permissions.ADMIN_ALL)
  @ApiOperation({ summary: 'Create a playbook node template' })
  async create(
    @Body() dto: CreatePlaybookNodeTemplateDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.templateService.create(dto, user._id.toString());
  }

  @Patch(':id')
  @RequirePermissions(Permissions.ADMIN_ALL)
  @ApiOperation({ summary: 'Update a playbook node template' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePlaybookNodeTemplateDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.templateService.update(id, dto, user._id.toString());
  }

  @Delete(':id')
  @RequirePermissions(Permissions.ADMIN_ALL)
  @ApiOperation({ summary: 'Delete a playbook node template' })
  async delete(@Param('id') id: string) {
    await this.templateService.delete(id);
    return { success: true };
  }
}
