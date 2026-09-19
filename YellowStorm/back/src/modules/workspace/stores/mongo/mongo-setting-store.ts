import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import {
  WorkspaceSetting,
  WorkspaceSettingDocument,
} from '../../schemas/workspace-setting.schema';
import { escapeRegex } from '../../../../common/utils';
import { SETTING_STORE, type SettingStore, type SettingCreateInput, type SettingListParams, type SettingUpdatePatch } from '../setting-store';
import type { WorkspaceSettingRecord } from '../../ports/workspace-records';
import { settingDocToRecord, toObjectId } from './mongo-store-mappers';

@Injectable()
export class MongoSettingStore implements SettingStore {
  constructor(
    @InjectModel(WorkspaceSetting.name)
    private readonly settingModel: Model<WorkspaceSettingDocument>,
  ) {}

  async create(input: SettingCreateInput): Promise<WorkspaceSettingRecord> {
    const setting = await this.settingModel.create({
      name: input.name,
      description: input.description,
      tag: input.tag,
      llmModel: input.llmModel,
      isTemplate: input.isTemplate,
      isPredefined: input.isPredefined,
      createdBy: toObjectId(input.createdBy),
      instruction: input.instruction,
      chunks: input.chunks,
      hybridSearch: input.hybridSearch,
      ragType: input.ragType,
      maxToken: input.maxToken,
      topK: input.topK,
    });
    return settingDocToRecord(setting);
  }

  async findById(id: string): Promise<WorkspaceSettingRecord | null> {
    const setting = await this.settingModel.findById(id);
    return setting ? settingDocToRecord(setting) : null;
  }

  async listByUser(userId: string, params: SettingListParams): Promise<{ items: WorkspaceSettingRecord[]; total: number }> {
    const { tag, search, skip, limit, sortBy, sortOrder } = params;
    const query: Record<string, unknown> = {
      createdBy: new Types.ObjectId(userId),
    };
    if (tag) {
      query.tag = tag;
    }
    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
      ];
    }
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };
    const [settings, total] = await Promise.all([
      this.settingModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.settingModel.countDocuments(query),
    ]);
    return { items: settings.map(settingDocToRecord), total };
  }

  async listTemplates(params: SettingListParams): Promise<{ items: WorkspaceSettingRecord[]; total: number }> {
    const { tag, search, skip, limit, sortBy, sortOrder } = params;
    const query: Record<string, unknown> = {
      isTemplate: true,
    };
    if (tag) {
      query.tag = tag;
    }
    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
      ];
    }
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };
    const [settings, total] = await Promise.all([
      this.settingModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.settingModel.countDocuments(query),
    ]);
    return { items: settings.map(settingDocToRecord), total };
  }

  async updateFields(id: string, patch: SettingUpdatePatch): Promise<void> {
    const set: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'tag', 'llmModel', 'isTemplate', 'instruction', 'chunks', 'hybridSearch', 'ragType', 'maxToken', 'topK'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (Object.keys(set).length > 0) {
      await this.settingModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: set });
    }
  }

  async deleteById(id: string): Promise<void> {
    await this.settingModel.deleteOne({ _id: id });
  }
}
