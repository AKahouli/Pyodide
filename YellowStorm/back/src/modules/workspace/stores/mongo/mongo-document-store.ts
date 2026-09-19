import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { WorkspaceDoc, WorkspaceDocumentDoc, DocumentStatus } from '../../schemas/workspace-document.schema';
import { escapeRegex } from '../../../../common/utils';
import { DOCUMENT_STORE, type DocumentStore, type DocumentCreateInput, type DocumentUpdatePatch, type DocumentListParams, type FolderDuplicateProbe, type WorkspaceDocumentListParams } from '../document-store';
import type { WorkspaceDocumentRecord } from '../../ports/workspace-records';
import { documentDocToRecord, toObjectId } from './mongo-store-mappers';

@Injectable()
export class MongoDocumentStore implements DocumentStore {
  constructor(
    @InjectModel(WorkspaceDoc.name)
    private readonly documentModel: Model<WorkspaceDocumentDoc>,
  ) {}

  async create(input: DocumentCreateInput): Promise<WorkspaceDocumentRecord> {
    const document = await this.documentModel.create({
      ...(input.id ? { _id: new Types.ObjectId(input.id) } : {}),
      filename: input.filename,
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.size,
      path: input.path,
      url: input.url,
      contentHash: input.contentHash,
      workspaceId: toObjectId(input.workspaceId),
      createdBy: toObjectId(input.createdBy),
      status: input.status,
      uploadedAt: input.uploadedAt,
      indexingStatus: input.indexingStatus,
      parentId: input.parentId ? new Types.ObjectId(input.parentId) : input.parentId === null ? null : undefined,
      isFolder: input.isFolder,
      folderName: input.folderName,
      type: input.type,
      sourceUrl: input.sourceUrl,
      metadata: input.metadata,
    });
    return documentDocToRecord(document);
  }

  async findById(id: string): Promise<WorkspaceDocumentRecord | null> {
    const doc = await this.documentModel.findById(id);
    return doc ? documentDocToRecord(doc) : null;
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<WorkspaceDocumentRecord | null> {
    const doc = await this.documentModel.findOne({
      _id: id,
      workspaceId: toObjectId(workspaceId),
    });
    return doc ? documentDocToRecord(doc) : null;
  }

  async findByIds(ids: string[]): Promise<WorkspaceDocumentRecord[]> {
    if (ids.length === 0) return [];
    const docs = await this.documentModel.find({ _id: { $in: ids.map(toObjectId) } }).exec();
    return docs.map(documentDocToRecord);
  }

  async findByIdsInWorkspace(workspaceId: string, ids: string[]): Promise<WorkspaceDocumentRecord[]> {
    if (ids.length === 0) return [];
    const docs = await this.documentModel
      .find({ _id: { $in: ids.map(toObjectId) }, workspaceId: toObjectId(workspaceId) })
      .exec();
    return docs.map(documentDocToRecord);
  }

  async originalNameExists(workspaceId: string, originalName: string): Promise<boolean> {
    const exists = await this.documentModel
      .exists({ workspaceId: toObjectId(workspaceId), originalName, isFolder: false })
      .lean();
    return Boolean(exists);
  }

  async findFolderDuplicate(probe: FolderDuplicateProbe): Promise<WorkspaceDocumentRecord | null> {
    const query: Record<string, unknown> = {
      workspaceId: toObjectId(probe.workspaceId),
      createdBy: new Types.ObjectId(probe.createdBy),
      isFolder: true,
      folderName: probe.folderName,
      parentId: probe.parentId ? new Types.ObjectId(probe.parentId) : null,
    };
    if (probe.excludeId) {
      query._id = { $ne: new Types.ObjectId(probe.excludeId) };
    }
    const existing = await this.documentModel.findOne(query);
    return existing ? documentDocToRecord(existing) : null;
  }

  async findChildFolderIds(parentId: string): Promise<string[]> {
    const children = await this.documentModel
      .find({ parentId: new Types.ObjectId(parentId), isFolder: true })
      .select('_id')
      .exec();
    return children.map((c) => c._id.toString());
  }

  async findDirectChildren(parentId: string, workspaceId: string): Promise<WorkspaceDocumentRecord[]> {
    const items = await this.documentModel.find({
      parentId: new Types.ObjectId(parentId),
      workspaceId: toObjectId(workspaceId),
    });
    return items.map(documentDocToRecord);
  }

  async findAllByWorkspaceId(workspaceId: string): Promise<WorkspaceDocumentRecord[]> {
    const docs = await this.documentModel.find({ workspaceId: toObjectId(workspaceId) });
    return docs.map(documentDocToRecord);
  }

  async listByWorkspace(workspaceId: string, params: WorkspaceDocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }> {
    const { status, search, parentId, sortBy = 'createdAt', sortOrder = 'desc', skip, limit } = params;
    const query: Record<string, unknown> = {
      workspaceId: toObjectId(workspaceId),
      status: status || 'completed',
    };
    if (parentId === null) {
      query.parentId = { $in: [null, undefined] };
    } else if (parentId !== undefined) {
      query.parentId = new Types.ObjectId(parentId);
    }
    if (search) {
      query.$or = [
        { originalName: { $regex: escapeRegex(search), $options: 'i' } },
        { folderName: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }
    const sort: Record<string, 1 | -1> = {
      isFolder: -1,
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };
    const [documents, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);
    return { items: documents.map(documentDocToRecord), total };
  }

  async listByWorkspaces(workspaceIds: string[], params: DocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }> {
    const { status, search, searchFilename, sortBy = 'createdAt', sortOrder = 'desc', skip, limit } = params;
    const query: Record<string, unknown> = {
      workspaceId: { $in: workspaceIds.map(toObjectId) },
      status: status || 'completed',
    };
    if (search) {
      const namePattern = { $regex: escapeRegex(search), $options: 'i' };
      if (searchFilename) {
        query.$or = [{ originalName: namePattern }, { filename: namePattern }];
      } else {
        query.originalName = namePattern;
      }
    }
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };
    const [documents, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);
    return { items: documents.map(documentDocToRecord), total };
  }

  async listFolders(workspaceId: string): Promise<WorkspaceDocumentRecord[]> {
    const query: Record<string, unknown> = {
      workspaceId: toObjectId(workspaceId),
      isFolder: true,
      status: 'completed',
    };
    const folders = await this.documentModel
      .find(query)
      .sort({ originalName: 1 })
      .exec();
    return folders.map(documentDocToRecord);
  }

  async listFolderContents(workspaceId: string, folderId: string, params: DocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }> {
    const { search, sortBy = 'originalName', sortOrder = 'asc', skip, limit } = params;
    const query: Record<string, unknown> = {
      workspaceId: toObjectId(workspaceId),
      parentId: new Types.ObjectId(folderId),
      status: 'completed',
    };
    if (search) {
      query.$or = [
        { originalName: { $regex: escapeRegex(search), $options: 'i' } },
        { folderName: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }
    const sort: Record<string, 1 | -1> = {
      isFolder: -1,
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };
    const [items, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);
    return { items: items.map(documentDocToRecord), total };
  }

  async findUrlSources(workspaceId: string): Promise<Array<Pick<WorkspaceDocumentRecord, 'id' | 'sourceUrl' | 'status' | 'indexingStatus'>>> {
    const documents = await this.documentModel
      .find({
        workspaceId: toObjectId(workspaceId),
        type: 'url',
        sourceUrl: { $exists: true },
      })
      .select('_id sourceUrl status indexingStatus')
      .lean()
      .exec();
    return documents.map((doc) => ({
      id: (doc._id as Types.ObjectId).toString(),
      sourceUrl: doc.sourceUrl ?? undefined,
      status: doc.status,
      indexingStatus: doc.indexingStatus,
    }));
  }

  async updateById(id: string, patch: DocumentUpdatePatch): Promise<WorkspaceDocumentRecord | null> {
    const set: Record<string, unknown> = {};
    for (const key of ['filename', 'originalName', 'folderName', 'path', 'url', 'contentHash', 'size', 'status', 'errorMessage', 'metadata', 'indexingStatus', 'indexingError'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.uploadedAt !== undefined) set.uploadedAt = patch.uploadedAt;
    if (Object.keys(set).length === 0) return this.findById(id);
    const updated = await this.documentModel.findByIdAndUpdate(id, { $set: set }, { new: true });
    return updated ? documentDocToRecord(updated) : null;
  }

  async mergeMetadata(workspaceId: string, documentId: string, patch: Record<string, string>): Promise<void> {
    const setObject = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [`metadata.${key}`, value]),
    );
    await this.documentModel
      .updateOne(
        { _id: toObjectId(documentId), workspaceId: toObjectId(workspaceId) },
        { $set: setObject },
      )
      .exec();
  }

  async markUploaded(id: string, fields: { status: string; uploadedAt: Date; url?: string; metadata?: Record<string, string> }): Promise<WorkspaceDocumentRecord | null> {
    const document = await this.documentModel.findById(id);
    if (!document) return null;
    document.status = fields.status as DocumentStatus;
    document.uploadedAt = fields.uploadedAt;
    if (fields.url !== undefined) document.url = fields.url;
    if (fields.metadata !== undefined) document.metadata = fields.metadata;
    await document.save();
    return documentDocToRecord(document);
  }

  async renameOriginalName(id: string, originalName: string): Promise<WorkspaceDocumentRecord | null> {
    const doc = await this.documentModel.findById(id);
    if (!doc) return null;
    doc.originalName = originalName;
    await doc.save();
    return documentDocToRecord(doc);
  }

  async renameFolder(id: string, folderName: string): Promise<WorkspaceDocumentRecord | null> {
    const folder = await this.documentModel.findById(id);
    if (!folder) return null;
    folder.folderName = folderName;
    folder.originalName = folderName;
    await folder.save();
    return documentDocToRecord(folder);
  }

  async setParent(id: string, parentId: string | null): Promise<void> {
    const document = await this.documentModel.findById(id);
    if (!document) return;
    document.parentId = parentId ? new Types.ObjectId(parentId) : undefined;
    await document.save();
  }

  async deleteById(id: string): Promise<void> {
    await this.documentModel.deleteOne({ _id: id });
  }

  async deleteByIdAndWorkspace(id: string, workspaceId: string): Promise<void> {
    await this.documentModel.deleteOne({
      _id: id,
      workspaceId: toObjectId(workspaceId),
    });
  }

  async deleteManyByWorkspace(workspaceId: string): Promise<number> {
    const result = await this.documentModel.deleteMany({
      workspaceId: toObjectId(workspaceId),
    });
    return result.deletedCount;
  }
}
