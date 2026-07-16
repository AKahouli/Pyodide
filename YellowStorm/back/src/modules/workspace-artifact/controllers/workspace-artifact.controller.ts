import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { UserDocument } from '../../user/schemas/user.schema';
import { WorkspaceAccessGuard, WritePermissionGuard } from '../../workspace/guards';
import { CreateDecisionFlowDto } from '../dto/create-decision-flow.dto';
import { UpdateDecisionFlowDto } from '../dto/update-decision-flow.dto';
import { WorkspaceArtifactQueryDto } from '../dto/workspace-artifact-query.dto';
import type { WorkspaceArtifactResponse } from '../interfaces/workspace-artifact.interface';
import { WorkspaceArtifactService } from '../services/workspace-artifact.service';

@ApiTags('Workspace Artifacts')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/artifacts')
@UseGuards(WorkspaceAccessGuard)
export class WorkspaceArtifactController {
  constructor(private readonly artifacts: WorkspaceArtifactService) {}
  @Get() @ApiOperation({ summary: 'List Workspace artifacts' })
  list(@Param('workspaceId') workspaceId: string, @Query() query: WorkspaceArtifactQueryDto): Promise<WorkspaceArtifactResponse[]> { return this.artifacts.list(workspaceId, query); }
  @Get('configuration') @ApiOperation({ summary: 'Get decision-flow generation availability' })
  configuration(): Promise<{ configured: boolean }> { return this.artifacts.getGenerationConfiguration(); }
  @Post('decision-flows') @UseGuards(WritePermissionGuard) @ApiOperation({ summary: 'Queue a PDF decision-flow generation' })
  create(@CurrentUser() user: UserDocument, @Param('workspaceId') workspaceId: string, @Body() dto: CreateDecisionFlowDto): Promise<WorkspaceArtifactResponse> { return this.artifacts.createDecisionFlow(workspaceId, user._id.toString(), dto); }
  @Get(':artifactId') @ApiOperation({ summary: 'Get a Workspace artifact' })
  get(@Param('workspaceId') workspaceId: string, @Param('artifactId') artifactId: string): Promise<WorkspaceArtifactResponse> { return this.artifacts.get(workspaceId, artifactId); }
  @Patch(':artifactId') @UseGuards(WritePermissionGuard) @ApiOperation({ summary: 'Update a decision-flow artifact' })
  update(@CurrentUser() user: UserDocument, @Param('workspaceId') workspaceId: string, @Param('artifactId') artifactId: string, @Body() dto: UpdateDecisionFlowDto): Promise<WorkspaceArtifactResponse> { return this.artifacts.update(workspaceId, artifactId, user._id.toString(), dto); }
  @Post(':artifactId/clone') @UseGuards(WritePermissionGuard) @ApiOperation({ summary: 'Clone a decision-flow artifact' })
  clone(@CurrentUser() user: UserDocument, @Param('workspaceId') workspaceId: string, @Param('artifactId') artifactId: string): Promise<WorkspaceArtifactResponse> { return this.artifacts.clone(workspaceId, artifactId, user._id.toString()); }
  @Post(':artifactId/retry') @UseGuards(WritePermissionGuard) @ApiOperation({ summary: 'Retry a failed decision-flow generation' })
  retry(@CurrentUser() user: UserDocument, @Param('workspaceId') workspaceId: string, @Param('artifactId') artifactId: string): Promise<WorkspaceArtifactResponse> { return this.artifacts.retry(workspaceId, artifactId, user._id.toString()); }
  @Delete(':artifactId') @UseGuards(WritePermissionGuard) @HttpCode(HttpStatus.NO_CONTENT) @ApiOperation({ summary: 'Delete a Workspace artifact' })
  async delete(@Param('workspaceId') workspaceId: string, @Param('artifactId') artifactId: string): Promise<void> { await this.artifacts.delete(workspaceId, artifactId); }
}
