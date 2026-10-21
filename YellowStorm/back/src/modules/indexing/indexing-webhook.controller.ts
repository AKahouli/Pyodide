import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../rate-limiter';
import { timingSafeStringEquals } from '@common/utils';
import { IndexingService } from './indexing.service';
import { LoggerService } from '../logger';
import type { IndexingProgress } from './interfaces/indexing.interface';

interface IndexingWebhookBody {
  event_type: string;
  task_id: string;
  status: string;
  processing_status?: string;
  processing_task_name?: string;
  processing_task_id?: string;
  detected_language?: string;
  metadata: {
    external_id: string;
    brain_id: string;
    error_message_image?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

@ApiTags('Indexing Webhook')
@Controller('indexing')
export class IndexingWebhookController {
  private readonly apiKey: string;

  constructor(
    private readonly indexingService: IndexingService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('IndexingWebhookController');
    this.apiKey = this.configService.get<string>('indexing.apiKey', '');
  }

  /**
   * Webhook endpoint for 3rd party indexing API to report status
   * Protected by API key in x-api-key header
   *
   * Body is typed as Record to bypass the global ValidationPipe
   * (forbidNonWhitelisted) since the external API sends dynamic fields.
   */
  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 100, windowMs: 60000, keyPrefix: 'indexing:webhook' })
  @ApiOperation({ summary: 'Webhook for indexing status updates' })
  @ApiHeader({
    name: 'x-api-key',
    description: 'API key for webhook authentication',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async handleWebhook(
    @Headers('x-api-key') apiKey: string,
    @Body() body: Record<string, unknown>,
  ) {
    // Validate API key (constant-time; fail closed when unconfigured)
    if (!this.apiKey || !timingSafeStringEquals(apiKey, this.apiKey)) {
      this.logger.warn('Webhook called with invalid API key');
      throw new UnauthorizedException('Invalid API key');
    }

    // Validate required fields manually
    const dto = body as unknown as IndexingWebhookBody;

    const status = dto.processing_status ?? dto.status;
    if (typeof status !== 'string' || !['START', 'PROCESSING', 'FINISH', 'FAIL'].includes(status)) {
      throw new BadRequestException('Invalid indexing status');
    }

    const documentId = dto.metadata?.external_id ?? dto.metadata?.document_id;
    if (typeof documentId !== 'string' || !documentId) {
      throw new BadRequestException('Missing document identifier in metadata');
    }

    let indexingProgress: IndexingProgress | undefined;
    if (body.current_step != null || body.total_steps != null || body.steps != null) {
      const { current_step, total_steps, steps, step_status, message } = body;
      if (!Number.isSafeInteger(current_step) || !Number.isSafeInteger(total_steps)
        || (current_step as number) < 0 || (total_steps as number) < 1
        || (current_step as number) > (total_steps as number)
        || (steps != null && (!Array.isArray(steps) || steps.length !== total_steps))
        || (step_status != null && !['PROCESSING', 'FINISH', 'FAIL'].includes(String(step_status)))
        || (message != null && typeof message !== 'string')) {
        throw new BadRequestException('Invalid indexing progress');
      }
      const schedule: IndexingProgress['steps'] = [];
      for (const [index, entry] of (steps as unknown[] ?? []).entries()) {
        if (!entry || typeof entry !== 'object') throw new BadRequestException('Invalid indexing step');
        const step = entry as Record<string, unknown>;
        // Provider WebhookStep names; retain compatibility with the original UI shape.
        const number = step.step_number ?? step.number;
        const name = step.task_name ?? step.name;
        const key = step.task_key ?? step.key;
        if (number !== index + 1 || typeof name !== 'string' || typeof key !== 'string'
          || typeof step.task_id !== 'string') throw new BadRequestException('Invalid indexing step');
        schedule.push({ number: number as number, name, key, task_id: step.task_id });
      }
      for (const field of ['processing_task_name', 'processing_task_key', 'processing_task_id']) {
        if (body[field] != null && typeof body[field] !== 'string') throw new BadRequestException(`Invalid ${field}`);
      }
      indexingProgress = {
        currentStep: current_step as number, totalSteps: total_steps as number, steps: schedule,
        stepStatus: (step_status ?? undefined) as IndexingProgress['stepStatus'], processingStatus: status,
        message: (message ?? undefined) as string | undefined,
        processingTaskName: dto.processing_task_name ?? undefined, processingTaskId: dto.processing_task_id ?? undefined,
        processingTaskKey: (body.processing_task_key ?? undefined) as string | undefined,
      };
    }

    this.logger.log('Webhook received', {
      documentId,
      eventType: dto.event_type,
      taskId: dto.processing_task_id || dto.task_id,
      taskName: dto.processing_task_name,
      rawStatus: dto.status,
      processingStatus: dto.processing_status,
    });

    await this.indexingService.handleWebhook(
      documentId,
      status,
      dto.detected_language,
      {
        processingStatus: dto.processing_status,
        processingTaskName: dto.processing_task_name,
        processingTaskId: dto.processing_task_id || dto.task_id,
        errorMessage: dto.metadata.error_message_image,
        indexingProgress,
      },
    );
    return {
      success: true,
      message: 'Webhook processed',
    };
  }
}
