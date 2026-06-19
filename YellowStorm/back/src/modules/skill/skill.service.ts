import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import AdmZip = require('adm-zip');
import * as yaml from 'js-yaml';
import { LoggerService } from '../logger';
import { Agent, AgentDocument } from '../agent/schemas/agent.schema';
import { AgentType, AgentTypeDocument } from '../agent-type/schemas/agent-type.schema';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { escapeRegex, stripTrailingChar } from '../../common/utils';
import { BadRequestException, ConflictException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { CreateSkillDto, QuerySkillDto, UpdateSkillDto } from './dto';
import { Skill, SkillDocument, SkillFileKind } from './schemas/skill.schema';
import { SkillCategory, SkillCategoryDocument } from './schemas/skill-category.schema';
import { ISkillResponse, IGrpcSkill } from './interfaces/skill.interface';

@Injectable()
export class SkillService {
  constructor(
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
    @InjectModel(SkillCategory.name)
    private readonly skillCategoryModel: Model<SkillCategoryDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(AgentType.name)
    private readonly agentTypeModel: Model<AgentTypeDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SkillService.name);
  }

  async create(createdBy: string, dto: CreateSkillDto): Promise<ISkillResponse> {
    const existing = await this.skillModel
      .findOne({ name: dto.name, createdBy: new Types.ObjectId(createdBy) })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException(ErrorCode.SKILL_ALREADY_EXISTS);
    }

    const skill = await this.skillModel.create({
      name: dto.name,
      description: dto.description,
      icon: dto.icon ?? '',
      color: dto.color ?? '',
      iconColor: dto.iconColor ?? 'light',
      categoryId: dto.categoryId ? new Types.ObjectId(dto.categoryId) : null,
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
      createdBy: new Types.ObjectId(createdBy),
    });

    return this.toResponse(skill);
  }

  async findAll(query: QuerySkillDto): Promise<PaginatedResponseDto<ISkillResponse>> {
    const filter: FilterQuery<SkillDocument> = {};
    if (query.search) {
      const regex = { $regex: escapeRegex(query.search), $options: 'i' };
      filter.$or = [{ name: regex }, { description: regex }];
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [skills, total] = await Promise.all([
      this.skillModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.skillModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(
      skills.map((skill) => this.toResponse(skill)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<ISkillResponse> {
    const skill = await this.skillModel.findById(id).lean().exec();
    if (!skill) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }
    return this.toResponse(skill);
  }

  async findByIds(ids: string[]): Promise<ISkillResponse[]> {
    if (!ids.length) {
      return [];
    }

    const skills = await this.skillModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();

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
    const skills = await this.skillModel
      .find({ isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();

    const categoryNameById = await this.buildCategoryNameMap(skills);

    return skills.map((skill) =>
      this.toResponse({
        ...skill,
        categoryName: skill.categoryId
          ? (categoryNameById.get(skill.categoryId.toString()) ?? null)
          : null,
      }),
    );
  }

  /** Resolve category id -> name for the given skills in a single query. */
  private async buildCategoryNameMap(
    skills: Array<{ categoryId?: Types.ObjectId | null }>,
  ): Promise<Map<string, string>> {
    const categoryIds = Array.from(
      new Set(
        skills
          .map((s) => s.categoryId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (!categoryIds.length) return new Map();

    const categories = await this.skillCategoryModel
      .find({ _id: { $in: categoryIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id name')
      .lean()
      .exec();

    return new Map(
      categories.map((cat: Record<string, unknown>) => [
        (cat._id as { toString(): string }).toString(),
        cat.name as string,
      ]),
    );
  }

  async update(id: string, dto: UpdateSkillDto): Promise<ISkillResponse> {
    const existing = await this.skillModel.findById(id).lean().exec();
    if (!existing) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }

    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.skillModel
        .findOne({ _id: { $ne: new Types.ObjectId(id) }, name: dto.name, createdBy: existing.createdBy })
        .lean()
        .exec();
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
    if (Object.prototype.hasOwnProperty.call(dto, 'categoryId')) {
      updateData.categoryId = dto.categoryId ? new Types.ObjectId(dto.categoryId) : null;
    }

    const updated = await this.skillModel
      .findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    const skill = await this.skillModel.findByIdAndDelete(id).lean().exec();
    if (!skill) {
      throw new NotFoundException(ErrorCode.SKILL_NOT_FOUND);
    }

    const skillId = new Types.ObjectId(id);
    await Promise.all([
      this.agentModel.updateMany({ skills: skillId }, { $pull: { skills: skillId } }).exec(),
      this.agentModel.updateMany({ disabledSkills: skillId }, { $pull: { disabledSkills: skillId } }).exec(),
      this.agentTypeModel.updateMany({ skills: skillId }, { $pull: { skills: skillId } }).exec(),
    ]);
  }

  async importPackage(createdBy: string, file: { originalname: string; buffer: Buffer }): Promise<ISkillResponse> {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A skill package file is required.');
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

    const skillRoot = stripTrailingChar(
      skillEntry.entryName.replace(/(^|\/)SKILL\.md$/i, ''),
      '/',
    );
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

  private parseSkillPackage(input: {
    skillMdContent: string;
    packageName: string;
    files: Array<{ path: string; content: string }>;
  }): CreateSkillDto {
    const match = input.skillMdContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'SKILL.md must start with YAML frontmatter.');
    }

    const frontmatter = (yaml.load(match[1]) as Record<string, unknown>) || {};
    const name = String(frontmatter.name || '').trim();
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
    const normalized = entryName.replace(/\\/g, '/');
    if (!skillRoot) {
      return normalized;
    }

    const rootPrefix = `${skillRoot}/`;
    return normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized;
  }

  private toResponse(skill: SkillDocument | Record<string, unknown>): ISkillResponse {
    const doc = skill as Record<string, unknown>;
    const files = Array.isArray(doc.files) ? doc.files as Array<Record<string, unknown>> : [];

    return {
      id: (doc._id as { toString(): string }).toString(),
      name: doc.name as string,
      description: (doc.description as string) || '',
      icon: (doc.icon as string) || '',
      color: (doc.color as string) || '',
      iconColor: ((doc.iconColor as 'light' | 'dark') || 'light'),
      categoryId: doc.categoryId ? (doc.categoryId as { toString(): string }).toString() : null,
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
      createdBy: doc.createdBy ? (doc.createdBy as { toString(): string }).toString() : '',
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    };
  }
}
