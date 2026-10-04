import { Inject, Injectable } from '@nestjs/common';
import AdmZip = require('adm-zip');
import * as yaml from 'js-yaml';
import { LoggerService } from '../logger';
import { isObjectId } from '@common/postgres';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { MULTIPART_SKILL_IMPORT_MAX_BYTES } from '../../common/utils';
import { BadRequestException, ConflictException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { CreateSkillDto, QuerySkillDto, UpdateSkillDto } from './dto';
import { SkillFileKind } from './skill.types';
import { SKILL_STORE,   type SkillRow,   type SkillStore } from './persistence/skill.store';
import { ISkillResponse, IGrpcSkill } from './interfaces/skill.interface';
import { PgSkillCategoryStore } from './persistence/pg-skill.store';

@Injectable()
export class SkillService {
  constructor(
    @Inject(SKILL_STORE)
    private readonly skillStore: SkillStore,
    private readonly categoryStore: PgSkillCategoryStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SkillService.name);
  }

  async create(createdBy: string, dto: CreateSkillDto): Promise<ISkillResponse> {
    const slug = dto.slug ?? dto.name;
    const existing = await this.skillStore.findByOwnerNameOrSlug(createdBy, dto.name, slug);
    if (existing) {
      throw new ConflictException(ErrorCode.SKILL_ALREADY_EXISTS);
    }

    const skill = await this.skillStore.insert({
      slug,
      name: dto.name,
      description: dto.description,
      icon: dto.icon ?? '',
      color: dto.color ?? '',
      iconColor: dto.iconColor ?? 'light',
      categoryId: dto.categoryId ?? null,
      license: dto.license ?? '',
      compatibility: dto.compatibility ?? '',
      metadata: dto.metadata ?? {},
      allowedTools: dto.allowedTools ?? [],
      instructions: dto.instructions ?? '',
      files: (dto.files ?? []).map((file) => ({
        path: file.path,
        kind: file.kind,
        mimeType: file.mimeType ?? '',
        content: file.content ?? '',
      })),
      isActive: dto.isActive ?? true,
      createdBy,
    });

    return this.toResponse(skill);
  }

  async findAll(query: QuerySkillDto): Promise<PaginatedResponseDto<ISkillResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    // List endpoints do not load file content (plan 1B.4.2).
    const { rows, total } = await this.skillStore.list({
      search: query.search,
      isActive: query.isActive,
      page,
      limit,
    });

    return new PaginatedResponseDto(
      rows.map((skill) => this.toResponse(skill)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<ISkillResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }
    const skill = await this.skillStore.findById(id);
    if (!skill) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }
    return this.toResponse(skill);
  }

  async findByIds(ids: string[]): Promise<ISkillResponse[]> {
    const skills = await this.skillStore.findByIds(ids);
    return skills.map((skill) => this.toResponse(skill));
  }

  /** Resolve active skills by id and map them to the gRPC wire shape (snake_case). */
  async findByIdsForGrpc(ids: string[]): Promise<IGrpcSkill[]> {
    const skills = await this.findByIds(ids);
    return skills.map((skill) => SkillService.toGrpcSkill(skill));
  }

  /** Convert an ISkillResponse to the gRPC `Skill` message shape. */
  static toGrpcSkill(skill: ISkillResponse): IGrpcSkill {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      license: skill.license,
      compatibility: skill.compatibility,
      metadata: skill.metadata,
      allowed_tools: skill.allowedTools,
      files: skill.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        mime_type: file.mimeType,
        content: file.content,
      })),
    };
  }

  async findAllActive(): Promise<ISkillResponse[]> {
    const skills = await this.skillStore.findAllActive();
    const categoryNameById = await this.buildCategoryNameMap(skills);

    return skills.map((skill) =>
      this.toResponse({
        ...skill,
        categoryName: skill.categoryId ? (categoryNameById.get(skill.categoryId) ?? null) : null,
      }),
    );
  }

  /** Resolve category id -> name for the given skills in a single query. */
  private async buildCategoryNameMap(
    skills: { categoryId?: string | null }[],
  ): Promise<Map<string, string>> {
    const categoryIds = Array.from(
      new Set(skills.map((s) => s.categoryId).filter((id): id is string => Boolean(id))),
    );
    if (!categoryIds.length) return new Map();
    return this.categoryStore.findNamesByIds(categoryIds);
  }

  async update(id: string, dto: UpdateSkillDto): Promise<ISkillResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }
    const existing = await this.skillStore.findById(id);
    if (!existing) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }

    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.skillStore.findByOwnerNameExcluding(existing.createdBy, id, dto.name);
      if (duplicate) {
        throw new ConflictException(ErrorCode.SKILL_ALREADY_EXISTS);
      }
    }

    if (dto.slug && dto.slug !== existing.slug) {
      const duplicate = await this.skillStore.findByOwnerSlugExcluding(existing.createdBy, id, dto.slug);
      if (duplicate) {
        throw new ConflictException(ErrorCode.SKILL_ALREADY_EXISTS);
      }
    }

    const updateData: Record<string, unknown> = { ...dto };
    if (dto.files) {
      updateData.files = dto.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        mimeType: file.mimeType ?? '',
        content: file.content ?? '',
      }));
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'categoryId')) {
      updateData.categoryId = (updateData.categoryId) || null;
    }

    const updated = await this.skillStore.update(id, updateData);
    if (!updated) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    // agent_skills / agent_disabled_skills junction rows cascade via the
    // validated agent FKs; agent_type_skills cascades on the skills table.
    const skill = await this.skillStore.delete(id);
    if (!skill) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }
  }

  async importPackage(createdBy: string, file: { originalname: string; buffer: Buffer; size?: number }): Promise<ISkillResponse> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A skill package file is required.');
    }

    const size = file.size ?? file.buffer.length;
    if (size > MULTIPART_SKILL_IMPORT_MAX_BYTES) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        `Skill package exceeds maximum size (${Math.floor(MULTIPART_SKILL_IMPORT_MAX_BYTES / 1024 / 1024)}MB).`,
      );
    }

    const lowerName = file.originalname.toLowerCase();
    if (lowerName.endsWith('.md')) {
      const parsed = this.parseSkillPackage({
        skillMdContent: file.buffer.toString('utf8'),
        packageName: file.originalname,
        files: [],
      });
      return this.create(createdBy, parsed);
    }

    if (!lowerName.endsWith('.zip')) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Only .md and .zip skill uploads are supported.');
    }

    const zip = new AdmZip(file.buffer);
    const entries = zip.getEntries().filter((entry: any) => !entry.isDirectory);
    const skillEntry = entries.find((entry: any) => /(^|\/)SKILL\.md$/i.test(entry.entryName));
    if (!skillEntry) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The uploaded zip does not contain a SKILL.md file.');
    }

    const skillRoot = skillEntry.entryName
      .replace(/(^|\/)SKILL\.md$/i, '')
      .replace(/\/+$/, '');
    const parsed = this.parseSkillPackage({
      skillMdContent: zip.readAsText(skillEntry, 'utf8'),
      packageName: file.originalname,
      files: entries
        .filter((entry: any) => entry.entryName !== skillEntry.entryName)
        .map((entry: any) => ({
          path: this.normalizeImportedPath(entry.entryName, skillRoot),
          content: zip.readAsText(entry, 'utf8'),
        }))
        .filter((entry: any) => entry.path),
    });

    return this.create(createdBy, parsed);
  }

  async exportPackage(id: string): Promise<{ filename: string; buffer: Buffer; skill: ISkillResponse }> {
    const skill = await this.findById(id);
    const zip = new AdmZip();

    zip.addFile('SKILL.md', Buffer.from(this.buildSkillMd(skill), 'utf8'));
    for (const file of skill.files) {
      const path = this.normalizeExportedPath(file.path);
      zip.addFile(path, Buffer.from(file.content, 'utf8'));
    }

    return {
      filename: `${this.slugifyFilename(skill.name)}.zip`,
      buffer: zip.toBuffer(),
      skill,
    };
  }

  private buildSkillMd(skill: ISkillResponse): string {
    const frontmatter = yaml.dump({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      license: skill.license || undefined,
      compatibility: skill.compatibility || undefined,
      metadata: Object.keys(skill.metadata).length ? skill.metadata : undefined,
      'allowed-tools': skill.allowedTools.length ? skill.allowedTools.join(' ') : undefined,
    }, { skipInvalid: true, lineWidth: -1 }).trim();

    return `---\n${frontmatter}\n---\n${skill.instructions.trim()}\n`;
  }

  private normalizeExportedPath(path: string): string {
    const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').includes('..')) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, `Skill file path cannot be exported: ${path}`);
    }
    return normalized;
  }

  private slugifyFilename(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
  }

  private parseSkillPackage(input: {
    skillMdContent: string;
    packageName: string;
    files: { path: string; content: string }[];
  }): CreateSkillDto {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(input.skillMdContent);
    if (!match) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'SKILL.md must start with YAML frontmatter.');
    }

    const frontmatter = (yaml.load(match[1]) as Record<string, unknown>) || {};
    const name = String(frontmatter.name || '').trim();
    const slug = String(frontmatter.slug || name).trim();
    const description = String(frontmatter.description || '').trim();
    if (!name || !description) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'SKILL.md must contain non-empty name and description fields.');
    }

    const metadataRaw = frontmatter.metadata;
    const metadata = metadataRaw && typeof metadataRaw === 'object'
      ? Object.fromEntries(Object.entries(metadataRaw as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {};
    const allowedToolsRaw = frontmatter['allowed-tools'];
    const allowedTools = typeof allowedToolsRaw === 'string'
      ? allowedToolsRaw.split(/\s+/).filter(Boolean)
      : [];

    return {
      slug,
      name,
      description,
      license: String(frontmatter.license || '').trim(),
      compatibility: String(frontmatter.compatibility || '').trim(),
      metadata,
      allowedTools,
      instructions: match[2].trim(),
      files: input.files.map((file) => ({
        path: file.path,
        kind: file.path.startsWith('references/') ? SkillFileKind.REFERENCE : SkillFileKind.ASSET,
        mimeType: file.path.endsWith('.md') ? 'text/markdown' : 'text/plain',
        content: file.content,
      })),
      isActive: true,
    };
  }

  private normalizeImportedPath(entryName: string, skillRoot: string): string {
    const normalized = entryName.replaceAll('\\', '/');
    if (!skillRoot) {
      return normalized;
    }

    const rootPrefix = `${skillRoot}/`;
    return normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized;
  }

  private toResponse(skill: SkillRow | Record<string, unknown>): ISkillResponse {
    const doc = skill as Record<string, unknown>;
    const files = Array.isArray(doc.files) ? doc.files as Record<string, unknown>[] : [];

    return {
      id: (doc.id as { toString(): string }).toString(),
      slug: (doc.slug as string) || (doc.name as string),
      name: doc.name as string,
      description: (doc.description as string) || '',
      icon: (doc.icon as string) || '',
      color: (doc.color as string) || '',
      iconColor: ((doc.iconColor as 'light' | 'dark') || 'light'),
      categoryId: (doc.categoryId as string) || null,
      categoryName: (doc.categoryName as string | null | undefined) ?? null,
      license: (doc.license as string) || '',
      compatibility: (doc.compatibility as string) || '',
      metadata: (doc.metadata as Record<string, string>) || {},
      allowedTools: ((doc.allowedTools as string[]) || []).slice(),
      instructions: (doc.instructions as string) || '',
      files: files.map((file) => ({
        path: (file.path as string) || '',
        kind: (file.kind as string) || '',
        mimeType: (file.mimeType as string) || '',
        content: (file.content as string) || '',
      })),
      isActive: (doc.isActive as boolean) ?? true,
      createdBy: (doc.createdBy as { toString(): string })?.toString() ?? '',
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    };
  }
}
