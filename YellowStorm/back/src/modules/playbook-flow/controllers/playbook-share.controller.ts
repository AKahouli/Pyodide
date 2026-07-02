import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { Permissions } from '@modules/authorization/constants/permissions';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { UserDocument } from '@modules/user';
import { FlowAccessService } from '../domain/flow-access.service';
import { SharePlaybookDto, UpdatePlaybookSharePermissionDto } from '../dto/share-playbook.dto';
import { IPlaybookShareEntry } from '../interfaces/playbook-share.interface';
import { PlaybookShareService } from '../services/playbook-share.service';

@ApiTags('Playbook Sharing')
@ApiBearerAuth()
@Controller('playbooks')
@UseGuards(PermissionsGuard)
export class PlaybookShareController {
  constructor(
    private readonly playbookShareService: PlaybookShareService,
    private readonly accessService: FlowAccessService,
  ) {}

  @Post(':id/shares')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  @ApiOperation({ summary: 'Share a playbook with users by email' })
  @ApiParam({ name: 'id', description: 'Playbook ID' })
  async sharePlaybook(
    @CurrentUser() user: UserDocument,
    @Param('id') playbookId: string,
    @Body() dto: SharePlaybookDto,
  ): Promise<IPlaybookShareEntry[]> {
    await this.accessService.findOwnedFlow(playbookId, user._id.toString());
    return this.playbookShareService.sharePlaybook(user._id.toString(), playbookId, dto);
  }

  @Get(':id/shares')
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  @ApiOperation({ summary: 'List all shares for a playbook' })
  @ApiParam({ name: 'id', description: 'Playbook ID' })
  async getPlaybookShares(
    @CurrentUser() user: UserDocument,
    @Param('id') playbookId: string,
  ): Promise<IPlaybookShareEntry[]> {
    await this.accessService.findOwnedFlow(playbookId, user._id.toString());
    return this.playbookShareService.getPlaybookShares(playbookId);
  }

  @Patch(':id/shares/:shareId')
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  @ApiOperation({ summary: 'Update a playbook share permission' })
  async updateSharePermission(
    @CurrentUser() user: UserDocument,
    @Param('id') playbookId: string,
    @Param('shareId') shareId: string,
    @Body() dto: UpdatePlaybookSharePermissionDto,
  ): Promise<IPlaybookShareEntry> {
    await this.accessService.findOwnedFlow(playbookId, user._id.toString());
    return this.playbookShareService.updateSharePermission(playbookId, shareId, dto);
  }

  @Delete(':id/shares/:shareId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  @ApiOperation({ summary: 'Revoke a playbook share' })
  async removeShare(
    @CurrentUser() user: UserDocument,
    @Param('id') playbookId: string,
    @Param('shareId') shareId: string,
  ): Promise<void> {
    await this.accessService.findOwnedFlow(playbookId, user._id.toString());
    return this.playbookShareService.removeShare(playbookId, shareId);
  }
}
