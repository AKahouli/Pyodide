import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  PayloadTooLargeException,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsMongoId, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { Public } from '../auth/decorators/public.decorator';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { DocumentService } from '../document/document.service';
import { SkipResponseWrap } from '../response/decorators/skip-response-wrap.decorator';
import { WorkspaceDocumentRead } from './document/document-read';
import { DocumentStatus } from './interfaces/document-status.enum';
import { WorkspaceShareService } from './workspace-share.service';

const SEMANTIC_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;

class SemanticAssetQueryDto {
  @ApiProperty()
  @IsMongoId()
  actorUserId!: string;

  @ApiProperty()
  @IsMongoId()
  workspaceId!: string;

  @ApiProperty()
  @IsMongoId()
  documentId!: string;
}

class SemanticDatasetQueryDto extends SemanticAssetQueryDto {
  @ApiProperty()
  @Matches(/^ds_[a-f0-9]{24}$/)
  datasetId!: string;
}

@ApiTags('Workspace Internal')
@Controller({ path: 'workspaces/internal', version: VERSION_NEUTRAL })
@UseGuards(InternalServiceGuard)
export class WorkspaceAssetInternalController {
  private readonly datasetPrefix: string;
  private readonly datasetMaxBytes: number;

  constructor(
    private readonly shares: WorkspaceShareService,
    private readonly documents: WorkspaceDocumentRead,
    private readonly storage: DocumentService,
    config: ConfigService,
  ) {
    this.datasetPrefix = config.get<string>('storage.semanticDatasetPrefix', 'semantic-model/datasets')
      .replace(/^\/+|\/+$/g, '');
    if (!this.datasetPrefix || !/^[a-zA-Z0-9/_-]+$/.test(this.datasetPrefix)
        || this.datasetPrefix.split('/').includes('..')) {
      throw new Error('Invalid SEMANTIC_DATASET_STORAGE_PREFIX');
    }
    const datasetMaxMb = config.get<number>('storage.semanticDatasetMaxSizeMb', 200);
    if (!Number.isSafeInteger(datasetMaxMb) || datasetMaxMb < 1 || datasetMaxMb > 2048) {
      throw new Error('Invalid SEMANTIC_DATASET_MAX_SIZE_MB');
    }
    this.datasetMaxBytes = datasetMaxMb * 1024 * 1024;
  }

  @Public()
  @Get('semantic-asset-metadata')
  @SkipResponseWrap()
  @ApiOperation({ summary: 'Reauthorize and describe a Workspace asset for the semantic runtime' })
  async metadata(@Query() query: SemanticAssetQueryDto) {
    await this.shares.assertUserHasAccess(query.actorUserId, [query.workspaceId]);
    const document = await this.documents.findById(query.workspaceId, query.documentId);
    if (document.isFolder || document.status !== DocumentStatus.COMPLETED) {
      throw new BadRequestException('Document is not available for semantic discovery');
    }
    return {
      workspaceId: document.workspaceId,
      assetId: document.id,
      originalName: document.originalName,
      uploaderUserId: document.createdBy,
      mimeType: document.mimeType,
      sizeBytes: document.size,
      contentHash: document.contentHash,
      uploadedAt: document.uploadedAt,
      indexingStatus: document.indexingStatus,
    };
  }

  @Public()
  @Get('semantic-asset')
  @SkipResponseWrap()
  @ApiOperation({ summary: 'Stream an authorized Workspace asset to the semantic runtime' })
  async content(@Query() query: SemanticAssetQueryDto, @Res() response: Response): Promise<void> {
    await this.shares.assertUserHasAccess(query.actorUserId, [query.workspaceId]);
    const document = await this.documents.findById(query.workspaceId, query.documentId);
    if (document.isFolder || document.status !== DocumentStatus.COMPLETED || !document.path) {
      throw new BadRequestException('Document is not available for semantic discovery');
    }
    if (document.size > SEMANTIC_PREVIEW_MAX_BYTES) {
      throw new PayloadTooLargeException('Document exceeds the semantic preview limit');
    }

    const stream = await this.storage.openReadStream(document.path);
    if (stream.contentLength !== undefined && stream.contentLength !== document.size) {
      stream.body.destroy();
      throw new ConflictException('Document storage metadata does not match the Workspace record');
    }

    response.status(200);
    response.setHeader('Content-Type', stream.contentType || document.mimeType || 'application/octet-stream');
    response.setHeader('Content-Length', document.size);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-YellowStorm-Workspace-Id', document.workspaceId);
    response.setHeader('X-YellowStorm-Asset-Id', document.id);
    response.setHeader('X-YellowStorm-Source-Size', document.size);
    response.setHeader('X-YellowStorm-Indexing-Status', document.indexingStatus);
    if (document.contentHash) response.setHeader('X-YellowStorm-Content-Hash', document.contentHash);
    if (document.uploadedAt) response.setHeader('X-YellowStorm-Uploaded-At', document.uploadedAt);

    let clientClosed = false;
    response.on('close', () => {
      clientClosed = true;
      if (!response.writableEnded) stream.body.destroy();
    });
    try {
      await pipeline(stream.body, response);
    } catch (error) {
      if (clientClosed || response.headersSent) {
        if (!response.destroyed) response.destroy(error as Error);
        return;
      }
      throw error;
    }
  }

  @Public()
  @Put('semantic-dataset')
  // The runtime checks this exact body against its manifest; the usual { success, data } envelope breaks that.
  @SkipResponseWrap()
  @ApiOperation({ summary: 'Store a prepared semantic dataset under an identity-derived key' })
  async putDataset(
    @Query() query: SemanticDatasetQueryDto,
    @Headers('content-length') rawLength: string | undefined,
    @Headers('x-content-sha256') contentHash: string | undefined,
    @Req() request: Request,
  ): Promise<{ datasetId: string; sizeBytes: number; contentHash: string }> {
    await this.shares.assertUserHasAccess(query.actorUserId, [query.workspaceId]);
    const document = await this.documents.findById(query.workspaceId, query.documentId);
    if (document.isFolder || document.status !== DocumentStatus.COMPLETED) {
      throw new BadRequestException('Source document is not available for dataset preparation');
    }
    const size = Number(rawLength);
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new BadRequestException('A valid Content-Length is required');
    }
    if (size > this.datasetMaxBytes) {
      throw new PayloadTooLargeException('Prepared dataset exceeds the storage limit');
    }
    if (!contentHash || !/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new BadRequestException('A lowercase SHA-256 content hash is required');
    }
    const objectKey = `${this.datasetPrefix}/${query.workspaceId}/${query.documentId}/${query.datasetId}.parquet`;
    await this.storage.putStream(
      objectKey,
      request,
      'application/vnd.apache.parquet',
      size,
      { sha256: contentHash, datasetid: query.datasetId },
    );
    return { datasetId: query.datasetId, sizeBytes: size, contentHash: `sha256:${contentHash}` };
  }

  @Public()
  @Get('semantic-dataset')
  @SkipResponseWrap()
  @ApiOperation({ summary: 'Stream an authorized prepared semantic dataset' })
  async dataset(@Query() query: SemanticDatasetQueryDto, @Res() response: Response): Promise<void> {
    await this.shares.assertUserHasAccess(query.actorUserId, [query.workspaceId]);
    const document = await this.documents.findById(query.workspaceId, query.documentId);
    if (document.isFolder || document.status !== DocumentStatus.COMPLETED) {
      throw new BadRequestException('Source document is not available for dataset access');
    }
    const objectKey = `${this.datasetPrefix}/${query.workspaceId}/${query.documentId}/${query.datasetId}.parquet`;
    const stream = await this.storage.openReadStream(objectKey);
    const size = stream.contentLength;
    const hash = stream.metadata?.sha256;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > this.datasetMaxBytes
        || stream.contentType !== 'application/vnd.apache.parquet'
        || stream.metadata?.datasetid !== query.datasetId
        || !hash || !/^[a-f0-9]{64}$/.test(hash)) {
      stream.body.destroy();
      throw new ConflictException('Prepared dataset metadata is invalid');
    }

    response.status(200);
    response.setHeader('Content-Type', 'application/vnd.apache.parquet');
    response.setHeader('Content-Length', size);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-YellowStorm-Workspace-Id', query.workspaceId);
    response.setHeader('X-YellowStorm-Asset-Id', query.documentId);
    response.setHeader('X-YellowStorm-Dataset-Id', query.datasetId);
    response.setHeader('X-YellowStorm-Content-Hash', `sha256:${hash}`);

    let clientClosed = false;
    response.on('close', () => {
      clientClosed = true;
      if (!response.writableEnded) stream.body.destroy();
    });
    try {
      await pipeline(stream.body, response);
    } catch (error) {
      if (clientClosed || response.headersSent) {
        if (!response.destroyed) response.destroy(error as Error);
        return;
      }
      throw error;
    }
  }
}
