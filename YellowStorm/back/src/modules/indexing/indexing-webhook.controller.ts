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
import { IndexingService } from './indexing.service';
import { LoggerService } from '../logger';

interface IndexingWebhookBody {
  event_type: string;
  task_id: string;
  status: string;
  detected_language?: string;
  metadata: {
    external_id: string;
    brain_id: string;
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
    // Validate API key
    if (!this.apiKey || apiKey !== this.apiKey) {
      this.logger.warn('Webhook called with invalid API key');
      throw new UnauthorizedException('Invalid API key');
    }

    // Validate required fields manually
    const dto = body as unknown as IndexingWebhookBody;

    if (!dto.status || typeof dto.status !== 'string') {
      throw new BadRequestException('Missing required field: status');
    }

    if (!dto.metadata?.external_id || typeof dto.metadata.external_id !== 'string') {
      throw new BadRequestException('Missing required field: metadata.external_id');
    }

    const documentId = dto.metadata.external_id;
    const status = dto.status === 'FINISH' ? 'READY' : 'FAILED';

    this.logger.log('Webhook received', {
      documentId,
      eventType: dto.event_type,
      taskId: dto.task_id,
      rawStatus: dto.status,
      mappedStatus: status,
    });

    await this.indexingService.handleWebhook(
      documentId,
      dto.status,
      dto.detected_language,
    );
    return {
      success: true,
      message: 'Webhook processed',
    };
  }
}
