import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { multipartFileInterceptorOptions } from '@common/utils';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { LogicalSearchEvaluationService } from '../services/logical-search-evaluation.service';

const EVAL_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

interface MulterFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('Evaluation')
@ApiBearerAuth()
@Controller('evaluation/logical-search')
export class LogicalSearchEvaluationController {
  constructor(private readonly service: LogicalSearchEvaluationService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a benchmark XLSX/CSV and parse it into a dataset' })
  @UseInterceptors(
    FileInterceptor('file', multipartFileInterceptorOptions(EVAL_UPLOAD_MAX_BYTES)),
  )
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: MulterFile) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No benchmark file uploaded.');
    }
    return this.service.uploadAndParse(user._id.toString(), file.originalname, file.buffer);
  }

  @Get()
  @ApiOperation({ summary: 'List logical search evaluations for the current user (paginated)' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('scope') scope?: string,
  ) {
    return this.service.listByOwner(user._id.toString(), {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      scope: scope === 'runs' || scope === 'benchmarks' ? scope : undefined,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an evaluation and its per-question results' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user._id.toString(), id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a logical search evaluation by id' })
  async getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getById(user._id.toString(), id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Create a new evaluation seeded from an existing benchmark dataset' })
  async duplicate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.duplicate(user._id.toString(), id);
  }

  @Post(':id/prepare-adhoc')
  @ApiOperation({ summary: 'Prepare evaluation with a direct agent/workspace/model config (no playbook)' })
  async prepareAdhoc(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { agentId: string; workspaceId?: string; modelId?: string; fileScope?: string[]; evaluatorAgentId: string; evaluatorModelId?: string },
  ) {
    if (!body?.agentId) {
      throw new BadRequestException('agentId is required.');
    }
    if (!body?.evaluatorAgentId) {
      throw new BadRequestException('evaluatorAgentId is required.');
    }
    return this.service.prepareAdhoc(user._id.toString(), id, body);
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Run the logical search benchmark queries against the runtime' })
  async run(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { queryIds?: string[]; queryId?: string },
  ) {
    const queryIds = body?.queryIds ?? (body?.queryId ? [body.queryId] : undefined);
    return this.service.run(user._id.toString(), id, { queryIds });
  }

  @Post(':id/stop')
  @ApiOperation({ summary: 'Request a graceful stop of a running evaluation (at the next query boundary)' })
  async stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.stop(user._id.toString(), id);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Live progress of a running evaluation (which query, how many done)' })
  async progress(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getProgress(user._id.toString(), id);
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'Get the aggregated summary and per-question results of an evaluation' })
  async results(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getResults(user._id.toString(), id);
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'Get the stored narrative report and the default interpreter agent id' })
  async report(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getReport(user._id.toString(), id);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Generate (or regenerate) the narrative report with an interpreter agent' })
  async generateReport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { agentId: string; locale?: string },
  ) {
    if (!body?.agentId) {
      throw new BadRequestException('agentId is required.');
    }
    return this.service.generateReport(user._id.toString(), id, body);
  }


  @Get(':id/export')
  @ApiOperation({ summary: 'Download the evaluation results as a ZIP (XLSX + raw execution logs JSON)' })
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.service.exportArchive(user._id.toString(), id);
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }
}
