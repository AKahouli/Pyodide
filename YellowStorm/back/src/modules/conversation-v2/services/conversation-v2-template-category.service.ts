import { Inject, Injectable, Logger } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import {
  CONVERSATION_V2_TEMPLATE_CATEGORY_STORE,
  CONVERSATION_V2_TEMPLATE_STORE,
  type ConversationV2TemplateCategoryRow,
  type ConversationV2TemplateCategoryStore,
  type ConversationV2TemplateStore,
} from '../persistence/conversation-v2-template.store';
import { CreateTemplateCategoryDto } from '../dto/create-template-category.dto';
import { UpdateTemplateCategoryDto } from '../dto/update-template-category.dto';
import { ITemplateCategoryResponse } from '../interfaces/template-catalog.interface';
import { slugifyCategoryName, isValidTemplateSlug } from '../utils/template-slug.util';
import { ConversationV2TemplatePublishService } from './conversation-v2-template-publish.service';

@Injectable()
export class ConversationV2TemplateCategoryService {
  private readonly logger = new Logger(ConversationV2TemplateCategoryService.name);

  constructor(
    @Inject(CONVERSATION_V2_TEMPLATE_CATEGORY_STORE)
    private readonly categories: ConversationV2TemplateCategoryStore,
    @Inject(CONVERSATION_V2_TEMPLATE_STORE)
    private readonly templates: ConversationV2TemplateStore,
    private readonly publish: ConversationV2TemplatePublishService,
  ) {}

  async create(dto: CreateTemplateCategoryDto): Promise<ITemplateCategoryResponse> {
    const slug = this.resolveSlug(dto.slug, dto.name);

    const [slugConflict, nameConflict] = await Promise.all([
      this.categories.findBySlug(slug),
      this.categories.findByNameInsensitive(dto.name),
    ]);
    if (slugConflict || nameConflict) {
      throw new ConflictException(ErrorCode.CONVERSATION_V2_TEMPLATE_CATEGORY_ALREADY_EXISTS);
    }

    const category = await this.categories.insert({
      name: dto.name.trim(),
      slug,
      icon: dto.icon?.trim() ?? '',
    });
    return this.toResponse(category, 0);
  }

  async findAll(): Promise<ITemplateCategoryResponse[]> {
    const categories = await this.categories.findAll();
    const counts = await this.categories.countTemplatesByCategoryIds(categories.map((c) => c.id));
    return categories.map((category) => this.toResponse(category, counts.get(category.id) ?? 0));
  }

  async findById(id: string): Promise<ITemplateCategoryResponse> {
    const category = await this.requireCategory(id);
    const counts = await this.categories.countTemplatesByCategoryIds([id]);
    return this.toResponse(category, counts.get(id) ?? 0);
  }

  async update(id: string, dto: UpdateTemplateCategoryDto): Promise<ITemplateCategoryResponse> {
    const current = await this.requireCategory(id);

    const patch: { name?: string; slug?: string; icon?: string } = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.icon !== undefined) patch.icon = dto.icon.trim();
    if (dto.slug !== undefined) patch.slug = this.resolveSlug(dto.slug, dto.name ?? current.name);

    if (patch.slug && patch.slug !== current.slug) {
      const conflict = await this.categories.findBySlug(patch.slug);
      if (conflict && conflict.id !== id) {
        throw new ConflictException(ErrorCode.CONVERSATION_V2_TEMPLATE_CATEGORY_ALREADY_EXISTS);
      }
    }
    if (patch.name && patch.name !== current.name) {
      const conflict = await this.categories.findByNameInsensitive(patch.name);
      if (conflict && conflict.id !== id) {
        throw new ConflictException(ErrorCode.CONVERSATION_V2_TEMPLATE_CATEGORY_ALREADY_EXISTS);
      }
    }

    const updated = await this.categories.update(id, patch);
    if (!updated) throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_CATEGORY_NOT_FOUND);

    const counts = await this.categories.countTemplatesByCategoryIds([id]);
    return this.toResponse(updated, counts.get(id) ?? 0);
  }

  /** Hard delete; templates cascade in the DB, their Ceph artifacts are cleaned here. */
  async delete(id: string): Promise<void> {
    await this.requireCategory(id);
    const templates = await this.templates.findByCategoryId(id);
    await this.categories.delete(id);
    await this.publish.removeTemplateArtifacts(templates);
    this.logger.log(`Deleted template category ${id} with ${templates.length} template(s)`);
  }

  private async requireCategory(id: string): Promise<ConversationV2TemplateCategoryRow> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_CATEGORY_NOT_FOUND);
    }
    const category = await this.categories.findById(id);
    if (!category) {
      throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_CATEGORY_NOT_FOUND);
    }
    return category;
  }

  private resolveSlug(explicit: string | undefined, name: string): string {
    const slug = (explicit?.trim() || slugifyCategoryName(name)).trim();
    if (!isValidTemplateSlug(slug)) {
      throw new BadRequestException(
        ErrorCode.VALIDATION_ERROR,
        'Category slug must be lowercase kebab-case.',
      );
    }
    return slug;
  }

  private toResponse(
    category: ConversationV2TemplateCategoryRow,
    templateCount: number,
  ): ITemplateCategoryResponse {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      icon: category.icon,
      templateCount,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
