import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { WorkspaceSetting, type WorkspaceSettingDocument } from '../../schemas/workspace-setting.schema';
import { WORKSPACE_SETTING_READ_PORT, type WorkspaceSettingReadPort } from '../../ports/workspace-setting-read.port';
import type { WorkspaceSettingRecord } from '../../ports/workspace-records';

@Injectable()
export class MongoWorkspaceSettingReadAdapter implements WorkspaceSettingReadPort {
  constructor(@InjectModel(WorkspaceSetting.name) private readonly settingModel: Model<WorkspaceSettingDocument>) {}

  async findById(id: string): Promise<WorkspaceSettingRecord | null> {
    const doc = await this.settingModel.findById(id).lean().exec();
    return doc ? settingToRecord(doc) : null;
  }

  async findByIds(ids: string[]): Promise<Map<string, WorkspaceSettingRecord>> {
    const map = new Map<string, WorkspaceSettingRecord>();
    if (ids.length === 0) return map;
    const docs = await this.settingModel.find({ _id: { $in: ids } }).lean().exec();
    for (const doc of docs) {
      const record = settingToRecord(doc);
      map.set(record.id, record);
    }
    return map;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function settingToRecord(doc: any): WorkspaceSettingRecord {
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description ?? undefined,
    tag: doc.tag ?? undefined,
    llmModel: doc.llmModel ?? undefined,
    isTemplate: Boolean(doc.isTemplate),
    isPredefined: Boolean(doc.isPredefined),
    createdBy: String(doc.createdBy ?? ''),
    instruction: doc.instruction ?? undefined,
    chunks: doc.chunks ?? 5,
    hybridSearch: Boolean(doc.hybridSearch),
    ragType: doc.ragType,
    maxToken: doc.maxToken ?? 4096,
    topK: doc.topK ?? 10,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}
