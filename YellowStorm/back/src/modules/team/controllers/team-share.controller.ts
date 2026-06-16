import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { TeamShareService } from '../services/team-share.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { ShareTeamDto, UpdateTeamSharePermissionDto } from '../dto';
import { ITeamShareEntry } from '../interfaces/team.interface';
import { TeamPermissionGuard } from '../guards/team-permission.guard';
import { RequireTeamPermission } from '../decorators/require-team-permission.decorator';

@ApiTags('Team Sharing')
@ApiBearerAuth()
@Controller('teams')
export class TeamShareController {
  constructor(private readonly teamShareService: TeamShareService) {}

  @Post(':id/shares')
  @UseGuards(TeamPermissionGuard)
  @RequireTeamPermission('owner')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Share a team with users by email' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async shareTeam(
    @CurrentUser() user: UserDocument,
    @Param('id') teamId: string,
    @Body() dto: ShareTeamDto,
  ): Promise<ITeamShareEntry[]> {
    return this.teamShareService.shareTeam(user._id.toString(), teamId, dto);
  }

  @Get(':id/shares')
  @UseGuards(TeamPermissionGuard)
  @RequireTeamPermission('owner')
  @ApiOperation({ summary: 'List all shares for a team' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async getTeamShares(@Param('id') teamId: string): Promise<ITeamShareEntry[]> {
    return this.teamShareService.getTeamShares(teamId);
  }

  @Patch(':id/shares/:shareId')
  @UseGuards(TeamPermissionGuard)
  @RequireTeamPermission('owner')
  @ApiOperation({ summary: 'Update a share permission' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  @ApiParam({ name: 'shareId', description: 'Share ID' })
  async updateSharePermission(
    @Param('id') teamId: string,
    @Param('shareId') shareId: string,
    @Body() dto: UpdateTeamSharePermissionDto,
  ): Promise<ITeamShareEntry> {
    return this.teamShareService.updateSharePermission(teamId, shareId, dto);
  }

  @Delete(':id/shares/:shareId')
  @UseGuards(TeamPermissionGuard)
  @RequireTeamPermission('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a share' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  @ApiParam({ name: 'shareId', description: 'Share ID' })
  async removeShare(
    @Param('id') teamId: string,
    @Param('shareId') shareId: string,
  ): Promise<void> {
    return this.teamShareService.removeShare(teamId, shareId);
  }

  @Delete(':id/unshare')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a shared team from your list' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async unshareFromSelf(
    @CurrentUser() user: UserDocument,
    @Param('id') teamId: string,
  ): Promise<void> {
    return this.teamShareService.unshareFromSelf(user._id.toString(), teamId);
  }
}
