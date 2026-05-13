import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';

@ApiTags('Playbook Flows')
@ApiBearerAuth()
@Controller('playbooks')
@UseGuards(PermissionsGuard)
export class PlaybookFlowController {
  constructor(private readonly playbookFlowService: PlaybookFlowService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async create(
    @CurrentUser('_id') userId: string,
    @Body() dto: CreatePlaybookFlowDto,
  ) {
    return this.playbookFlowService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List playbook flows' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findAll(
    @CurrentUser('_id') userId: string,
    @Query() query: PlaybookFlowQueryDto,
  ) {
    return this.playbookFlowService.findAll(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a playbook flow by id' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findOne(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playbookFlowService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async update(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlaybookFlowDto,
  ) {
    return this.playbookFlowService.update(id, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_DELETE)
  async remove(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playbookFlowService.remove(id, userId);
  }
}
