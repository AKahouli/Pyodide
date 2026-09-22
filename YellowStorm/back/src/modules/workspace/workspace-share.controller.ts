import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam } from '@nestjs/swagger';
import { WorkspaceShareService } from './workspace-share.service';
import { WorkspaceOwnerGuard } from './guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import {
  ShareWorkspaceDto,
  ShareQueryDto,
  UpdateSharePermissionDto,
  ShareWorkspaceResultDto,
  PaginatedSharesDto,
  WorkspaceShareResponseDto,
} from './dto';
import {
  ShareWorkspaceResult,
  WorkspaceShareResponse,
  PaginatedShares,
} from './interfaces/workspace-share.interface';

@ApiTags('Workspace Shares')
@Controller('workspaces/:id/shares')
@ApiBearerAuth()
@UseGuards(WorkspaceOwnerGuard)
export class WorkspaceShareController {
  constructor(private readonly workspaceShareService: WorkspaceShareService) {}

  @Post()
  @ApiOperation({ summary: 'Share workspace with users by email' })
  @ApiResponse({
    status: 201,
    description: 'Workspace shared successfully',
    type: ShareWorkspaceResultDto,
  })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  async share(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body() dto: ShareWorkspaceDto,
  ): Promise<ShareWorkspaceResult> {
    return this.workspaceShareService.share(workspaceId, user._id.toString(), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all shares for a workspace' })
  @ApiResponse({
    status: 200,
    description: 'Shares retrieved successfully',
    type: PaginatedSharesDto,
  })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  async findByWorkspace(
    @Param('id') workspaceId: string,
    @Query() query: ShareQueryDto,
  ): Promise<PaginatedShares> {
    return this.workspaceShareService.findByWorkspace(workspaceId, query);
  }

  @Patch(':shareId')
  @ApiOperation({ summary: 'Update permission on a share' })
  @ApiResponse({
    status: 200,
    description: 'Permission updated successfully',
    type: WorkspaceShareResponseDto,
  })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  @ApiParam({ name: 'shareId', description: 'Share ID' })
  async updatePermission(
    @Param('id') workspaceId: string,
    @Param('shareId') shareId: string,
    @Body() dto: UpdateSharePermissionDto,
  ): Promise<WorkspaceShareResponse> {
    return this.workspaceShareService.updatePermission(workspaceId, shareId, dto.permission);
  }

  @Delete(':shareId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a share' })
  @ApiResponse({ status: 200, description: 'Share revoked successfully' })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  @ApiParam({ name: 'shareId', description: 'Share ID' })
  async revoke(
    @Param('id') workspaceId: string,
    @Param('shareId') shareId: string,
  ): Promise<{ message: string }> {
    await this.workspaceShareService.revoke(workspaceId, shareId);
    return { message: 'Share revoked successfully' };
  }
}
