import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { WorkspaceDoc, type WorkspaceDocumentDoc } from '../../schemas/workspace-document.schema';
import {
  WORKSPACE_DOCUMENT_READ_PORT,
  type WorkspaceDocumentReadPort,
} from '../../ports/workspace-document-read.port';
import { mapFilter, mapSort, toObjectId } from './mongo-adapter-utils';
import type { DocumentFilter, DocumentFindOptions } from '../../ports/document-filter';
import type { WorkspaceDocumentRecord } from '../../ports/workspace-records';

@Injectable()
export class MongoWorkspaceDocumentReadAdapter implements WorkspaceDocumentReadPort {
  constructor(@InjectModel(WorkspaceDoc.name) private readonly documentModel: Model<WorkspaceDocumentDoc>) {}

  async findById(id: string): Promise<WorkspaceDocumentRecord | null> {
    const doc = await this.documentModel.findById(id).lean().exec();
    return doc ? documentToRecord(doc) : null;
  }

  async findOne(filter: DocumentFilter): Promise<WorkspaceDocumentRecord | null> {
    const doc = await this.documentModel.findOne(mapFilter(filter)).lean().exec();
    return doc ? documentToRecord(doc) : null;
  }

  async find(filter: DocumentFilter, opts: DocumentFindOptions = {}): Promise<WorkspaceDocumentRecord[]> {
    let query = this.documentModel.find(mapFilter(filter));
    if (opts.sort) {
      query = query.sort(mapSort(opts.sort.field, opts.sort.direction));
    }
    if (opts.skip) query = query.skip(opts.skip);
    if (opts.limit) query = query.limit(opts.limit);
    const docs = await query.lean().exec();
    return docs.map(documentToRecord);
  }

  async countDocuments(filter: DocumentFilter): Promise<number> {
    return this.documentModel.countDocuments(mapFilter(filter)).exec();
  }

  async exists(filter: DocumentFilter): Promise<boolean> {
    const found = await this.documentModel.exists(mapFilter(filter)).exec();
    return Boolean(found);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function documentToRecord(doc: any): WorkspaceDocumentRecord {
  return {
    id: String(doc._id),
    filename: doc.filename ?? undefined,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size ?? 0,
    path: doc.path ?? undefined,
    url: doc.url ?? undefined,
    contentHash: doc.contentHash ?? undefined,
    workspaceId: String(doc.workspaceId ?? ''),
    createdBy: String(doc.createdBy ?? ''),
    status: doc.status,
    uploadedAt: doc.uploadedAt ? new Date(doc.uploadedAt) : undefined,
    errorMessage: doc.errorMessage ?? undefined,
    metadata: doc.metadata ? { ...doc.metadata } : undefined,
    indexingStatus: doc.indexingStatus,
    indexingError: doc.indexingError ?? undefined,
    indexingTaskName: doc.indexingTaskName ?? undefined,
    indexingTaskId: doc.indexingTaskId ?? undefined,
    indexingAttemptId: doc.indexingAttemptId ?? undefined,
    indexingAttemptStartedAt: doc.indexingAttemptStartedAt ? new Date(doc.indexingAttemptStartedAt) : undefined,
    indexingAttemptCompletedAt: doc.indexingAttemptCompletedAt ? new Date(doc.indexingAttemptCompletedAt) : undefined,
    lastIndexedAt: doc.lastIndexedAt ? new Date(doc.lastIndexedAt) : undefined,
    indexingStartedAt: doc.indexingStartedAt ? new Date(doc.indexingStartedAt) : undefined,
    detected_language: doc.detected_language ?? undefined,
    chunk_size: doc.chunk_size ?? undefined,
    parentId: doc.parentId ? String(doc.parentId) : undefined,
    isFolder: Boolean(doc.isFolder),
    folderName: doc.folderName ?? undefined,
    type: doc.type,
    sourceUrl: doc.sourceUrl ?? undefined,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

export { toObjectId };
