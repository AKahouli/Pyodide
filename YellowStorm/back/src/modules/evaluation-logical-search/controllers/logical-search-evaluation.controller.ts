import { BadRequestException, Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { multipartFileInterceptorOptions } from '@common/utils';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
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
  async upload(@CurrentUser() user: UserDocument, @UploadedFile() file: MulterFile) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No benchmark file uploaded.');
    }
    return this.service.uploadAndParse(user._id.toString(), file.originalname, file.buffer);
  }

  @Get()
  @ApiOperation({ summary: 'List logical search evaluations for the current user' })
  async list(@CurrentUser() user: UserDocument) {
    return this.service.listByOwner(user._id.toString());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a logical search evaluation by id' })
  async getById(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.service.getById(user._id.toString(), id);
  }

  @Post(':id/prepare')
  @ApiOperation({ summary: 'Capture a playbook execution snapshot and generate evaluator inputs' })
  async prepare(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() body: { executionId: string; agentId?: string; workspaceId?: string },
  ) {
    if (!body?.executionId) {
      throw new BadRequestException('executionId is required.');
    }
    return this.service.prepare(user._id.toString(), id, body);
  }

  @Post(':id/prepare-adhoc')
  @ApiOperation({ summary: 'Prepare evaluation with a direct agent/workspace/model config (no playbook)' })
  async prepareAdhoc(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() body: { agentId: string; workspaceId?: string; modelId?: string; fileScope?: string[] },
  ) {
    if (!body?.agentId) {
      throw new BadRequestException('agentId is required.');
    }
    return this.service.prepareAdhoc(user._id.toString(), id, body);
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Run the logical search benchmark queries against the runtime' })
  async run(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.service.run(user._id.toString(), id);
  }

  @Post(':id/stop')
  @ApiOperation({ summary: 'Request a graceful stop of a running evaluation (at the next query boundary)' })
  async stop(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.service.stop(user._id.toString(), id);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Live progress of a running evaluation (which query, how many done)' })
  async progress(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.service.getProgress(user._id.toString(), id);
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Download the logical search evaluation results as XLSX' })
  async export(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.service.exportXlsx(user._id.toString(), id);
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="logical_search_evaluation_${id}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }
}
