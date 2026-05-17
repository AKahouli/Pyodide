import { Controller, Get, Param, UseGuards, Body, Post, Delete, Patch } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { PlaybookFlowNodeTemplateService } from '../services/playbook-flow-node-template.service';
import { CreateFlowNodeTemplateDto } from '../dto/create-flow-node-template.dto';
import { UpdateFlowNodeTemplateDto } from '../dto/update-flow-node-template.dto';

@ApiTags('Playbook Flow Templates')
@ApiBearerAuth()
@Controller({ path: 'playbook-flow-templates', version: '1' })
@UseGuards(PermissionsGuard)
export class PlaybookFlowTemplateController {
  constructor(
    private readonly nodeTemplateService: PlaybookFlowNodeTemplateService,
  ) {}

  @Get('node-kinds')
  @ApiOperation({ summary: 'List available node kinds' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  getNodeKinds() {
    return {
      kinds: [
        { kind: 'step', label: 'Step' },
        { kind: 'router', label: 'Router' },
        { kind: 'iterator', label: 'Iterator' },
        { kind: 'human_approval', label: 'Human Approval' },
      ],
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all node templates' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findAll() {
    return this.nodeTemplateService.findAll();
  }

  @Get('enabled')
  @ApiOperation({ summary: 'List enabled node templates' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findEnabled() {
    return this.nodeTemplateService.findEnabled();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a node template by ID' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findById(@Param('id') id: string) {
    return this.nodeTemplateService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a node template' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async create(@CurrentUser() user: { _id: string }, @Body() body: CreateFlowNodeTemplateDto) {
    return this.nodeTemplateService.create(body, user._id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a node template' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async update(@Param('id') id: string, @CurrentUser() user: { _id: string }, @Body() body: UpdateFlowNodeTemplateDto) {
    return this.nodeTemplateService.update(id, body, user._id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a node template' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async delete(@Param('id') id: string) {
    await this.nodeTemplateService.delete(id);
    return { success: true };
  }
}
