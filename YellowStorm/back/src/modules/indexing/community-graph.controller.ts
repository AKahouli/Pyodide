import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam } from '@nestjs/swagger';
import { IndexingService } from './indexing.service';
import { WorkspaceOwnerGuard } from '../workspace/guards/workspace-owner.guard';

@ApiTags('Community Graph')
@Controller('workspaces/:workspaceId/graph')
@ApiBearerAuth()
@UseGuards(WorkspaceOwnerGuard)
export class CommunityGraphController {
  constructor(private readonly indexingService: IndexingService) {}

  @Get()
  @ApiOperation({ summary: 'Get community graph visualization data for a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiResponse({ status: 200, description: 'Graph data retrieved' })
  async getGraphData(
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.indexingService.getCommunityGraphData(workspaceId);
  }
}
