import { Inject, Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { DocumentService } from '@modules/document/document.service';
import {
  CONVERSATION_V2_TEMPLATE_CATEGORY_STORE,
  CONVERSATION_V2_TEMPLATE_STORE,
  type ConversationV2TemplateCategoryStore,
  type ConversationV2TemplateRow,
  type ConversationV2TemplateStore,
} from '../persistence/conversation-v2-template.store';
import { CreateTemplateDto } from '../dto/create-template.dto';
import { UpdateTemplateDto } from '../dto/update-template.dto';
import { ITemplateResponse } from '../interfaces/template-catalog.interface';
import { MulterFile } from '../interfaces/multer-file.interface';
import {
  TEMPLATE_COVER_MAX_BYTES,
  TEMPLATE_COVER_MIME_TYPES,
  TEMPLATE_MAX_ZIP_BYTES,
  templateCoverKey,
} from '../constants/template-catalog.constants';
import { ConversationV2TemplatePublishService } from './conversation-v2-template-publish.service';
import { collectTemplateCephKeys } from '../utils/template-ceph-cleanup.util';

@Injectable()
export class ConversationV2TemplateService {
  constructor(
    @Inject(CONVERSATION_V2_TEMPLATE_STORE)
    private readonly templates: ConversationV2TemplateStore,
    @Inject(CONVERSATION_V2_TEMPLATE_CATEGORY_STORE)
    private readonly categories: ConversationV2TemplateCategoryStore,
    private readonly publish: ConversationV2TemplatePublishService,
    private readonly documents: DocumentService,
  ) {}

  /** Create a draft template, store its cover, then publish the ZIP to Ceph. */
  async create(
    dto: CreateTemplateDto,
    zip: MulterFile | undefined,
    cover: MulterFile | undefined,
  ): Promise<ITemplateResponse> {
    const category = await this.categories.findById(dto.categoryId);
    if (!category) {
      throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_CATEGORY_NOT_FOUND);
    }
    this.assertZip(zip);
    this.assertCover(cover);

    const duplicate = await this.templates.findByCategoryAndTitle(dto.categoryId, dto.title.trim());
    if (duplicate) {
      throw new ConflictException(ErrorCode.CONVERSATION_V2_TEMPLATE_ALREADY_EXISTS);
    }

    const row = await this.templates.insert({
      categoryId: dto.categoryId,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? '',
      coverImage: '',
    });

    try {
      const coverKey = await this.uploadCover(row.id, cover);
      const published = await this.publish.publish(row.id, zip.buffer);
      await this.templates.update(row.id, { coverImage: coverKey });
      const bound = await this.templates.setRevision(row.id, {
        revisionId: published.revisionId,
        manifestObjectKey: published.manifestObjectKey,
        platformReport: published.platformReport,
      });
      if (!bound) {
        throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_FOUND);
      }
      await this.templates.upsertRevision({
        templateId: row.id,
        revisionId: published.revisionId,
        manifestObjectKey: published.manifestObjectKey,
        manifestHash: published.manifestHash,
        files: published.files,
      });
      const confirmed = await this.templates.markPublished(row.id);
      if (!confirmed) {
        throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_PUBLISHED);
      }
      await this.templates.markRevisionsPublished(row.id);
      return await this.toResponse(confirmed, category.name);
    } catch (error) {
      await this.templates.delete(row.id).catch(() => undefined);
      throw error;
    }
  }

  async listAll(): Promise<ITemplateResponse[]> {
    const [rows, categories] = await Promise.all([
      this.templates.listAll(),
      this.categories.findAll(),
    ]);
    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    return Promise.all(rows.map((row) => this.toResponse(row, nameById.get(row.categoryId) ?? '')));
  }

  /** Public gallery: published templates only. */
  async listPublished(categoryId?: string): Promise<ITemplateResponse[]> {
    const [rows, categories] = await Promise.all([
      this.templates.listPublished(categoryId),
      this.categories.findAll(),
    ]);
    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    return Promise.all(rows.map((row) => this.toResponse(row, nameById.get(row.categoryId) ?? '')));
  }

  async findById(id: string): Promise<ITemplateResponse> {
    const row = await this.requireTemplate(id);
    const category = await this.categories.findById(row.categoryId);
    return this.toResponse(row, category?.name ?? '');
  }

  /** Published template or 404 — the entry point for the "use" flow. */
  async requirePublished(id: string): Promise<ConversationV2TemplateRow> {
    const row = await this.requireTemplate(id);
    if (row.status !== 'published' || !row.revisionId) {
      throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_PUBLISHED);
    }
    return row;
  }

  /**
   * Usable template revision for starting a session. Users may only use
   * published templates; super admins may also open drafts (legacy rows).
   */
  async requireUsableForUser(
    id: string,
    isSuperAdmin: boolean,
  ): Promise<ConversationV2TemplateRow> {
    const row = await this.requireTemplate(id);
    if (!row.revisionId || (!isSuperAdmin && row.status !== 'published')) {
      throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_PUBLISHED);
    }
    return row;
  }

  async update(id: string, dto: UpdateTemplateDto): Promise<ITemplateResponse> {
    const current = await this.requireTemplate(id);
    const categoryId = dto.categoryId ?? current.categoryId;
    const title = dto.title?.trim() ?? current.title;

    if (dto.categoryId && dto.categoryId !== current.categoryId) {
      const category = await this.categories.findById(dto.categoryId);
      if (!category) {
        throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_CATEGORY_NOT_FOUND);
      }
    }
    if (categoryId !== current.categoryId || title !== current.title) {
      const duplicate = await this.templates.findByCategoryAndTitle(categoryId, title);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(ErrorCode.CONVERSATION_V2_TEMPLATE_ALREADY_EXISTS);
      }
    }

    const patch: { categoryId?: string; title?: string; description?: string } = {};
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.title !== undefined) patch.title = title;
    if (dto.description !== undefined) patch.description = dto.description.trim();

    const updated = await this.templates.update(id, patch);
    if (!updated) throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_FOUND);
    const category = await this.categories.findById(updated.categoryId);
    return this.toResponse(updated, category?.name ?? '');
  }

  /** Replace the cover image; drops the previous Ceph object. */
  async replaceCover(id: string, cover: MulterFile | undefined): Promise<ITemplateResponse> {
    const current = await this.requireTemplate(id);
    this.assertCover(cover);
    const coverKey = await this.uploadCover(id, cover);
    const updated = await this.templates.update(id, { coverImage: coverKey });
    if (!updated) throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_FOUND);
    if (current.coverImage && current.coverImage !== coverKey) {
      await this.publish.removeTemplateArtifacts([{ ...current, manifestObjectKey: null }]);
    }
    const category = await this.categories.findById(updated.categoryId);
    return this.toResponse(updated, category?.name ?? '');
  }

  /** Replace the source ZIP and re-bind the same revision id (publishes). */
  async replaceSource(id: string, zip: MulterFile | undefined): Promise<ITemplateResponse> {
    await this.requireTemplate(id);
    this.assertZip(zip);
    const published = await this.publish.publish(id, zip.buffer);
    const updated = await this.templates.setRevision(id, {
      revisionId: published.revisionId,
      manifestObjectKey: published.manifestObjectKey,
      platformReport: published.platformReport,
    });
    if (!updated) throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_FOUND);
    await this.templates.upsertRevision({
      templateId: id,
      revisionId: published.revisionId,
      manifestObjectKey: published.manifestObjectKey,
      manifestHash: published.manifestHash,
      files: published.files,
    });
    const confirmed = (await this.templates.markPublished(id)) ?? updated;
    await this.templates.markRevisionsPublished(id);
    const category = await this.categories.findById(confirmed.categoryId);
    return this.toResponse(confirmed, category?.name ?? '');
  }

  /**
   * Hard-delete the catalog row, then remove cover/manifests/unreferenced
   * blobs from Ceph in the background so the confirm dialog is not blocked
   * on storage I/O.
   */
  async delete(id: string): Promise<void> {
    const current = await this.requireTemplate(id);
    const pending = await this.collectCephCleanup(current);
    const row = await this.templates.delete(id);
    if (!row) throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_FOUND);
    this.scheduleCephCleanup(pending);
  }

  /** Gather cover + revision manifests/blobs before the DB cascade drops them. */
  private async collectCephCleanup(template: ConversationV2TemplateRow): Promise<{
    coverImage: string;
    manifestKeys: string[];
    blobKeys: string[];
  }> {
    const revisions = await this.templates.listRevisionsByTemplate(template.id);
    return collectTemplateCephKeys(template, revisions);
  }

  /**
   * Fire-and-forget Ceph cleanup. Blobs are deleted only when no other
   * template or workspace revision still references them.
   */
  private scheduleCephCleanup(pending: {
    coverImage: string;
    manifestKeys: string[];
    blobKeys: string[];
  }): void {
    void (async () => {
      try {
        const unreferencedBlobs = await this.templates.filterUnreferencedBlobKeys(
          pending.blobKeys,
        );
        await this.publish.removeTemplateArtifacts([
          {
            coverImage: pending.coverImage,
            objectKeys: [...pending.manifestKeys, ...unreferencedBlobs],
          },
        ]);
      } catch {
        // Best-effort: DB delete already committed; Ceph cleanup must not surface.
      }
    })();
  }

  private async requireTemplate(id: string): Promise<ConversationV2TemplateRow> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_FOUND);
    }
    const row = await this.templates.findById(id);
    if (!row) throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_FOUND);
    return row;
  }

  private async uploadCover(templateId: string, cover: MulterFile): Promise<string> {
    const extension = TEMPLATE_COVER_MIME_TYPES[cover.mimetype];
    const objectKey = templateCoverKey(templateId, extension);
    await this.documents.upload(
      cover.buffer,
      `cover${extension}`,
      cover.mimetype,
      { generateUniqueName: false, customFileName: objectKey },
    );
    return objectKey;
  }

  private assertZip(zip: MulterFile | undefined): asserts zip is MulterFile {
    if (!zip?.buffer.length) {
      throw new BadRequestException(
        ErrorCode.CONVERSATION_V2_TEMPLATE_ZIP_INVALID,
        'A template source ZIP is required.',
      );
    }
    if (zip.size > TEMPLATE_MAX_ZIP_BYTES) {
      throw new BadRequestException(
        ErrorCode.CONVERSATION_V2_TEMPLATE_ZIP_INVALID,
        'The template ZIP exceeds the 50MB limit.',
      );
    }
  }

  private assertCover(cover: MulterFile | undefined): asserts cover is MulterFile {
    if (!cover?.buffer.length || !TEMPLATE_COVER_MIME_TYPES[cover.mimetype]) {
      throw new BadRequestException(
        ErrorCode.CONVERSATION_V2_TEMPLATE_COVER_INVALID,
        'A PNG, JPEG, WebP, or SVG cover image is required.',
      );
    }
    if (cover.size > TEMPLATE_COVER_MAX_BYTES) {
      throw new BadRequestException(
        ErrorCode.CONVERSATION_V2_TEMPLATE_COVER_INVALID,
        'The cover image exceeds the 5MB limit.',
      );
    }
  }

  private async toResponse(
    row: ConversationV2TemplateRow,
    categoryName: string,
  ): Promise<ITemplateResponse> {
    const coverImage = row.coverImage
      ? await this.documents.generateSasUrl(row.coverImage, { allowExtensionless: true })
      : '';
    return {
      id: row.id,
      categoryId: row.categoryId,
      categoryName,
      title: row.title,
      description: row.description,
      coverImage,
      status: row.status,
      revisionId: row.revisionId,
      platformReport: row.platformReport,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
