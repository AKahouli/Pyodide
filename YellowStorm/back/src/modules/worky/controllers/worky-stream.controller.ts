import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WorkyStreamService } from '../services/worky-stream.service';
import { WorkyExecutionService } from '../services/worky-execution.service';
import { WorkyBudgetService, WorkyBudgetSnapshot } from '../services/worky-budget.service';
import { WorkyReportService, IWorkyExecutionReportResponse } from '../services/worky-report.service';
import { CreateWorkyStreamDto } from '../dto/create-worky-stream.dto';
import { UpdateWorkyStreamDto } from '../dto/update-worky-stream.dto';
import { QueryWorkyStreamsDto } from '../dto/query-worky-streams.dto';
import { WorkyStreamControlDto } from '../dto/worky-stream-control.dto';
import { WorkyBudgetControlDto } from '../dto/worky-budget-control.dto';
import {
  IWorkyStreamResponse,
  IWorkyStreamListResult,
} from '../interfaces/worky-stream.interface';
import {
  IWorkyExecutionSnapshotResponse,
  IWorkyStartValidationResult,
} from '../interfaces/worky-execution.interface';
import { WorkyStreamAccessGuard } from '../guards/worky-stream-access.guard';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { Permissions } from '../../authorization/constants/permissions';

@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/streams')
export class WorkyStreamController {
  constructor(
    private readonly streams: WorkyStreamService,
    private readonly execution: WorkyExecutionService,
    private readonly budget: WorkyBudgetService,
    private readonly report: WorkyReportService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Create a Worky stream' })
  @ApiResponse({ status: 201, description: 'Stream created' })
  async create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateWorkyStreamDto,
  ): Promise<IWorkyStreamResponse> {
    return this.streams.create(user._id.toString(), dto);
  }

  @Get()
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({
    summary: 'List the owner’s Worky streams (paginated, with per-stream task stats)',
  })
  async findAll(
    @CurrentUser() user: UserDocument,
    @Query() query: QueryWorkyStreamsDto,
  ): Promise<IWorkyStreamListResult> {
    return this.streams.findAllForUser(user._id.toString(), query);
  }

  @Get(':id')
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'Get a Worky stream by id' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async findById(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<IWorkyStreamResponse> {
    return this.streams.findById(user._id.toString(), id);
  }

  @Patch(':id')
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Patch a Worky stream (title only)' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateWorkyStreamDto,
  ): Promise<IWorkyStreamResponse> {
    return this.streams.patch(user._id.toString(), id, dto);
  }

  @Delete(':id/delete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Delete a Worky stream and its artifact workspace' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async delete(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<{ ok: true; deletedWorkspaceId: string | null }> {
    return this.streams.delete(user._id.toString(), id);
  }

  // ----- Lifecycle (Part 3) -----

  /**
   * Validate-and-start. Always succeeds. The result tells the UI
   * whether all tasks are runnable, only some, or none. The
   * `partially_executable` outcome is *not* an error — partial progress
   * is by design.
   */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_EXECUTE)
  @ApiOperation({ summary: 'Validate and start a Worky stream execution' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async start(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<IWorkyStartValidationResult> {
    return this.execution.createSnapshot(id, user._id.toString());
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_EXECUTE)
  @ApiOperation({ summary: 'Pause a running Worky stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async pause(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: WorkyStreamControlDto,
  ): Promise<IWorkyExecutionSnapshotResponse | null> {
    return this.execution.pause(id, user._id.toString(), dto.reason);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_EXECUTE)
  @ApiOperation({ summary: 'Resume a paused Worky stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async resume(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: WorkyStreamControlDto,
  ): Promise<IWorkyExecutionSnapshotResponse | null> {
    return this.execution.resume(id, user._id.toString(), dto.reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Stop a Worky stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async stop(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: WorkyStreamControlDto,
  ): Promise<{ ok: true }> {
    await this.execution.stop(id, user._id.toString(), dto.reason);
    return { ok: true };
  }

  // ----- Budget (Part 4 §4) -----

  @Get(':id/budget')
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'Get the live budget snapshot for a Worky stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async getBudget(@Param('id') id: string): Promise<WorkyBudgetSnapshot> {
    return this.budget.getSnapshot(id);
  }

  @Patch(':id/budget')
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Update the budget limits for a Worky stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async updateBudget(
    @Param('id') id: string,
    @Body() dto: WorkyBudgetControlDto,
  ): Promise<WorkyBudgetSnapshot> {
    return this.budget.setLimits(id, {
      limitUsd: dto.limitUsd,
      limitTokens: dto.limitTokens,
      enforcement: dto.enforcement,
    });
  }

  // ----- Execution report (Part 4 §6) -----

  @Get(':id/execution-report')
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'Get the latest execution report for a Worky stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async getReport(
    @Param('id') id: string,
  ): Promise<IWorkyExecutionReportResponse | null> {
    return this.report.findForStream(id);
  }

  @Post(':id/execution-report')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Generate (or regenerate) the execution report' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async generateReport(
    @Param('id') id: string,
  ): Promise<IWorkyExecutionReportResponse> {
    return this.report.generate(id);
  }
}
