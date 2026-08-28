import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { DocumentService } from '@modules/document/document.service';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PlaybookAssistantAttachment, PlaybookAssistantAttachmentDocument } from '../schemas/playbook-assistant-attachment.schema';
import type { PlaybookIntentImageInputDto } from '../dto/request-playbook-flow-intent.dto';

const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
const MAX_ATTACHMENT_BYTES = 1_500_000;
const ATTACHMENT_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class PlaybookAssistantAttachmentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaybookAssistantAttachmentService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(PlaybookAssistantAttachment.name)
    private readonly attachmentModel: Model<PlaybookAssistantAttachmentDocument>,
    private readonly documentService: DocumentService,
  ) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => void this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  async initialize(input: {
    ownerId: string;
    playbookId: string;
    requestId: string;
    expectedDefinitionRevision: number;
    mediaType: string;
    size: number;
  }) {
    if (!ALLOWED_MEDIA_TYPES.includes(input.mediaType as typeof ALLOWED_MEDIA_TYPES[number])) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Unsupported assistant image type');
    }
    if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Assistant image exceeds the allowed size');
    }
    const existingCount = await this.attachmentModel.countDocuments({
      ownerId: input.ownerId,
      requestId: input.requestId,
      expiresAt: { $gt: new Date() },
    }).exec();
    if (existingCount >= 4) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Cannot attach more than four images');
    }
    const attachmentId = randomUUID();
    const extension = this.extensionFor(input.mediaType);
    const objectKey = `playbook-assistant/${input.ownerId}/${attachmentId}.${extension}`;
    const expiresAt = new Date(Date.now() + ATTACHMENT_TTL_MS);
    await this.attachmentModel.create({
      attachmentId,
      requestId: input.requestId,
      ownerId: input.ownerId,
      playbookId: input.playbookId,
      expectedDefinitionRevision: input.expectedDefinitionRevision,
      objectKey,
      mediaType: input.mediaType,
      declaredSize: input.size,
      status: 'pending',
      expiresAt,
    });
    try {
      const uploadUrl = await this.documentService.generateSasUrl(objectKey, { permissions: 'cw', expiryMinutes: 10 });
      return { attachmentId, uploadUrl, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      await this.attachmentModel.deleteOne({ attachmentId }).exec();
      throw error;
    }
  }

  async confirm(ownerId: string, playbookId: string, attachmentId: string) {
    const attachment = await this.findOwned(ownerId, playbookId, attachmentId);
    const metadata = await this.documentService.getMetadata(attachment.objectKey);
    if (!metadata || metadata.size < 1 || metadata.size > MAX_ATTACHMENT_BYTES || metadata.size !== attachment.declaredSize) {
      await this.safeDelete(attachment.objectKey);
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Uploaded assistant image size does not match');
    }
    const bytes = await this.documentService.download(attachment.objectKey);
    if (!this.matchesMediaType(bytes, attachment.mediaType)) {
      await this.safeDelete(attachment.objectKey);
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Uploaded assistant image content is invalid');
    }
    await this.attachmentModel.updateOne(
      { attachmentId, ownerId, playbookId },
      { $set: { status: 'confirmed', actualSize: bytes.length, contentSha256: this.digest(bytes) } },
    ).exec();
    return { attachmentId, status: 'confirmed' as const };
  }

  async assertBindings(input: {
    ownerId: string;
    playbookId: string;
    requestId: string;
    expectedDefinitionRevision: number;
    attachmentIds: string[];
  }): Promise<void> {
    if (input.attachmentIds.length > 4 || new Set(input.attachmentIds).size !== input.attachmentIds.length) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid assistant attachment set');
    }
    if (input.attachmentIds.length === 0) return;
    const count = await this.attachmentModel.countDocuments({
      attachmentId: { $in: input.attachmentIds },
      ownerId: input.ownerId,
      playbookId: input.playbookId,
      requestId: input.requestId,
      expectedDefinitionRevision: input.expectedDefinitionRevision,
      status: 'confirmed',
      expiresAt: { $gt: new Date() },
    }).exec();
    if (count !== input.attachmentIds.length) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant attachment binding is invalid or expired');
    }
  }

  async resolveImages(input: {
    ownerId: string;
    playbookId: string;
    requestId: string;
    expectedDefinitionRevision: number;
    attachmentIds: string[];
  }): Promise<PlaybookIntentImageInputDto[]> {
    await this.assertBindings(input);
    const attachments = await this.attachmentModel.find({ attachmentId: { $in: input.attachmentIds } }).lean().exec();
    const byId = new Map(attachments.map((attachment) => [attachment.attachmentId, attachment]));
    return Promise.all(input.attachmentIds.map(async (attachmentId) => {
      const attachment = byId.get(attachmentId)!;
      const bytes = await this.documentService.download(attachment.objectKey);
      if (bytes.length !== attachment.actualSize
        || !attachment.contentSha256
        || !this.matchesMediaType(bytes, attachment.mediaType)
        || this.digest(bytes) !== attachment.contentSha256) {
        await this.safeDelete(attachment.objectKey);
        throw new ConflictException(ErrorCode.CONFLICT, 'Confirmed assistant image content changed after verification');
      }
      return { mediaType: attachment.mediaType, data: bytes.toString('base64') };
    }));
  }

  private async findOwned(ownerId: string, playbookId: string, attachmentId: string): Promise<PlaybookAssistantAttachment> {
    const attachment = await this.attachmentModel.findOne({ attachmentId, ownerId, playbookId }).lean().exec();
    if (!attachment || attachment.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant attachment not found or expired');
    }
    return attachment;
  }

  private async cleanupExpired(): Promise<void> {
    const expired = await this.attachmentModel.find({ expiresAt: { $lte: new Date() } }).limit(100).lean().exec();
    const deletedIds: string[] = [];
    for (const attachment of expired) {
      if (await this.safeDelete(attachment.objectKey)) deletedIds.push(attachment.attachmentId);
    }
    if (deletedIds.length > 0) {
      await this.attachmentModel.deleteMany({ attachmentId: { $in: deletedIds } }).exec();
    }
  }

  private async safeDelete(objectKey: string): Promise<boolean> {
    try {
      await this.documentService.delete(objectKey);
      return true;
    } catch (error) {
      this.logger.warn(`playbook_assistant_attachment_cleanup_failed objectKey=${objectKey} error=${error instanceof Error ? error.message : 'unknown'}`);
      return false;
    }
  }

  private extensionFor(mediaType: string): string {
    return mediaType === 'image/jpeg' ? 'jpg' : mediaType.split('/')[1];
  }

  private matchesMediaType(bytes: Buffer, mediaType: string): boolean {
    if (mediaType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mediaType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    if (mediaType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
    if (mediaType === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    return false;
  }

  private digest(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }
}
