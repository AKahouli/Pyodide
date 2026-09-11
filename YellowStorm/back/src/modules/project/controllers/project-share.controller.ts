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
import { ProjectShareService } from '../project-share.service';
import { ProjectOwnerGuard } from '../guards/project-owner.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import {
  ShareProjectDto,
  ShareQueryDto,
  UpdateSharePermissionDto,
} from '../dto';
import {
  IShareProjectResult,
  IProjectShareResponse,
  IPaginatedProjectShares,
} from '../interfaces/project.interface';

@ApiTags('Project Shares')
@Controller('projects/:id/shares')
@ApiBearerAuth()
@UseGuards(ProjectOwnerGuard)
export class ProjectShareController {
  constructor(private readonly projectShareService: ProjectShareService) {}

  @Post()
  @ApiOperation({ summary: 'Share project with users by email' })
  @ApiResponse({ status: 201, description: 'Project shared successfully' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  async share(
    @CurrentUser() user: UserDocument,
    @Param('id') projectId: string,
    @Body() dto: ShareProjectDto,
  ): Promise<IShareProjectResult> {
    return this.projectShareService.share(projectId, user._id.toString(), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all shares for a project' })
  @ApiResponse({ status: 200, description: 'Shares retrieved successfully' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  async findByProject(
    @Param('id') projectId: string,
    @Query() query: ShareQueryDto,
  ): Promise<IPaginatedProjectShares> {
    return this.projectShareService.findByProject(projectId, query);
  }

  @Patch(':shareId')
  @ApiOperation({ summary: 'Update permission on a share' })
  @ApiResponse({ status: 200, description: 'Permission updated successfully' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiParam({ name: 'shareId', description: 'Share ID' })
  async updatePermission(
    @Param('id') projectId: string,
    @Param('shareId') shareId: string,
    @Body() dto: UpdateSharePermissionDto,
  ): Promise<IProjectShareResponse> {
    return this.projectShareService.updatePermission(projectId, shareId, dto.permission);
  }

  @Delete(':shareId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a share' })
  @ApiResponse({ status: 200, description: 'Share revoked successfully' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiParam({ name: 'shareId', description: 'Share ID' })
  async revoke(
    @Param('id') projectId: string,
    @Param('shareId') shareId: string,
  ): Promise<{ message: string }> {
    await this.projectShareService.revoke(projectId, shareId);
    return { message: 'Share revoked successfully' };
  }
}
