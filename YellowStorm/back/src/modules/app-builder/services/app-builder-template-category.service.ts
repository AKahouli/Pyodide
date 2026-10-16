import { Inject, Injectable, Logger } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import {
  APP_BUILDER_TEMPLATE_CATEGORY_STORE,
  APP_BUILDER_TEMPLATE_STORE,
  type AppBuilderTemplateCategoryRow,
  type AppBuilderTemplateCategoryStore,
  type AppBuilderTemplateStore,
} from '../persistence/app-builder-template.store';
import { CreateTemplateCategoryDto } from '../dto/create-template-category.dto';
import { UpdateTemplateCategoryDto } from '../dto/update-template-category.dto';
import { ITemplateCategoryResponse } from '../interfaces/template-catalog.interface';
import { slugifyCategoryName, isValidTemplateSlug } from '../utils/template-slug.util';
import { AppBuilderTemplatePublishService } from './app-builder-template-publish.service';
import { collectTemplateCephKeys } from '../utils/template-ceph-cleanup.util';

@Injectable()
export class AppBuilderTemplateCategoryService {
  private readonly logger = new Logger(AppBuilderTemplateCategoryService.name);

  constructor(
    @Inject(APP_BUILDER_TEMPLATE_CATEGORY_STORE)
    private readonly categories: AppBuilderTemplateCategoryStore,
    @Inject(APP_BUILDER_TEMPLATE_STORE)
    private readonly templates: AppBuilderTemplateStore,
    private readonly publish: AppBuilderTemplatePublishService,
  ) {}

  async create(dto: CreateTemplateCategoryDto): Promise<ITemplateCategoryResponse> {
    const slug = this.resolveSlug(dto.slug, dto.name);

    const [slugConflict, nameConflict] = await Promise.all([
      this.categories.findBySlug(slug),
      this.categories.findByNameInsensitive(dto.name),
    ]);
    if (slugConflict || nameConflict) {
      throw new ConflictException(ErrorCode.APP_BUILDER_TEMPLATE_CATEGORY_ALREADY_EXISTS);
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
        throw new ConflictException(ErrorCode.APP_BUILDER_TEMPLATE_CATEGORY_ALREADY_EXISTS);
      }
    }
    if (patch.name && patch.name !== current.name) {
      const conflict = await this.categories.findByNameInsensitive(patch.name);
      if (conflict && conflict.id !== id) {
        throw new ConflictException(ErrorCode.APP_BUILDER_TEMPLATE_CATEGORY_ALREADY_EXISTS);
      }
    }

    const updated = await this.categories.update(id, patch);
    if (!updated) throw new NotFoundException(ErrorCode.APP_BUILDER_TEMPLATE_CATEGORY_NOT_FOUND);

    const counts = await this.categories.countTemplatesByCategoryIds([id]);
    return this.toResponse(updated, counts.get(id) ?? 0);
  }

  /**
   * Hard delete; templates cascade in the DB. Cover/manifests/unreferenced
   * blobs are removed from Ceph in the background so the admin confirm dialog
   * is not blocked on storage I/O.
   */
  async delete(id: string): Promise<void> {
    await this.requireCategory(id);
    const templates = await this.templates.findByCategoryId(id);
    const pending = await Promise.all(
      templates.map(async (template) => {
        const revisions = await this.templates.listRevisionsByTemplate(template.id);
        return collectTemplateCephKeys(template, revisions);
      }),
    );
    await this.categories.delete(id);
    void (async () => {
      try {
        const blobCandidates = [...new Set(pending.flatMap((item) => item.blobKeys))];
        const unreferencedBlobs =
          await this.templates.filterUnreferencedBlobKeys(blobCandidates);
        const unreferenced = new Set(unreferencedBlobs);
        await this.publish.removeTemplateArtifacts(
          pending.map((item) => ({
            coverImage: item.coverImage,
            objectKeys: [
              ...item.manifestKeys,
              ...item.blobKeys.filter((key) => unreferenced.has(key)),
            ],
          })),
        );
      } catch (error) {
        this.logger.warn(
          `Background Ceph cleanup failed after deleting category ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();
    this.logger.log(`Deleted template category ${id} with ${templates.length} template(s)`);
  }

  private async requireCategory(id: string): Promise<AppBuilderTemplateCategoryRow> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.APP_BUILDER_TEMPLATE_CATEGORY_NOT_FOUND);
    }
    const category = await this.categories.findById(id);
    if (!category) {
      throw new NotFoundException(ErrorCode.APP_BUILDER_TEMPLATE_CATEGORY_NOT_FOUND);
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
    category: AppBuilderTemplateCategoryRow,
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
