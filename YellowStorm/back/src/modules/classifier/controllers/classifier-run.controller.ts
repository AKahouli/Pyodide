import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ClassifierRunService } from '../services/classifier-run.service';
import { StartRunDto } from '../dto/start-run.dto';
import { ListRunsQueryDto } from '../dto/list-runs-query.dto';
import { IClassificationRunResponse } from '../interfaces/classifier.interface';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';

interface PaginatedRunsResponse {
  items: IClassificationRunResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@ApiTags('Classifier · Runs')
@ApiBearerAuth()
@Controller('classifier')
export class ClassifierRunController {
  constructor(private readonly runService: ClassifierRunService) {}

  @Post('workspaces/:workspaceId/runs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a classification run via a playbook' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  start(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: StartRunDto,
  ): Promise<IClassificationRunResponse> {
    return this.runService.start(user._id.toString(), workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/runs')
  @ApiOperation({ summary: 'List recent classification runs for a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  async list(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListRunsQueryDto,
  ): Promise<PaginatedRunsResponse> {
    const result = await this.runService.listByWorkspace(
      user._id.toString(),
      workspaceId,
      query,
    );
    return {
      items: result.items,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
      },
    };
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get a classification run by id (poll for status)' })
  @ApiParam({ name: 'id', description: 'Run ID' })
  findById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<IClassificationRunResponse> {
    return this.runService.findById(user._id.toString(), id);
  }
}
