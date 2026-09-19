import { Types } from 'mongoose';
import type { WorkspaceDocumentDoc } from '../../schemas/workspace-document.schema';
import type { WorkspaceDocument } from '../../schemas/workspace.schema';
import type { WorkspaceShareDocument } from '../../schemas/workspace-share.schema';
import type { WorkspaceSettingDocument } from '../../schemas/workspace-setting.schema';
import type { UploadSessionDocument } from '../../schemas/upload-session.schema';
import type { WorkspaceRecord, WorkspaceDocumentRecord, WorkspaceShareRecord, WorkspaceSettingRecord } from '../../ports/workspace-records';
import type { UploadSessionRecord } from '../upload-session-store';

/** Mongo document → store record mappers. Records use string ids so both the
 * Mongo stores and the PG stores return identical shapes to the services. */

export function workspaceDocToRecord(doc: WorkspaceDocument): WorkspaceRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    alias: doc.alias,
    storagePrefix: doc.storagePrefix,
    description: doc.description ?? undefined,
    createdBy: doc.createdBy.toString(),
    settingsId: doc.settings?.toString(),
    documentCount: doc.documentCount,
    usedStorage: doc.usedStorage,
    allocatedStorage: doc.allocatedStorage,
    isSystem: doc.isSystem || false,
    isPersonal: doc.isPersonal || false,
    shareCount: doc.shareCount || 0,
    isPublic: doc.isPublic || false,
    conversationId: doc.conversationId?.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function documentDocToRecord(doc: WorkspaceDocumentDoc): WorkspaceDocumentRecord {
  return {
    id: doc._id.toString(),
    filename: doc.filename ?? undefined,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    path: doc.path ?? undefined,
    url: doc.url ?? undefined,
    contentHash: doc.contentHash ?? undefined,
    workspaceId: doc.workspaceId.toString(),
    createdBy: doc.createdBy.toString(),
    status: doc.status,
    uploadedAt: doc.uploadedAt ?? undefined,
    errorMessage: doc.errorMessage ?? undefined,
    metadata: doc.metadata ?? undefined,
    indexingStatus: doc.indexingStatus,
    indexingError: doc.indexingError ?? undefined,
    indexingTaskName: doc.indexingTaskName ?? undefined,
    indexingTaskId: doc.indexingTaskId ?? undefined,
    indexingAttemptId: doc.indexingAttemptId ?? undefined,
    indexingAttemptStartedAt: doc.indexingAttemptStartedAt ?? undefined,
    indexingAttemptCompletedAt: doc.indexingAttemptCompletedAt ?? undefined,
    lastIndexedAt: doc.lastIndexedAt ?? undefined,
    indexingStartedAt: doc.indexingStartedAt ?? undefined,
    detected_language: doc.detected_language,
    chunk_size: doc.chunk_size,
    parentId: doc.parentId?.toString(),
    isFolder: doc.isFolder || false,
    folderName: doc.folderName ?? undefined,
    type: doc.type,
    sourceUrl: doc.sourceUrl ?? undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function shareDocToRecord(doc: WorkspaceShareDocument): WorkspaceShareRecord {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    ownerId: doc.ownerId.toString(),
    sharedWithUserId: doc.sharedWithUserId.toString(),
    permission: doc.permission,
    sharedBy: doc.sharedBy.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function settingDocToRecord(doc: WorkspaceSettingDocument): WorkspaceSettingRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description ?? undefined,
    tag: doc.tag ?? undefined,
    llmModel: doc.llmModel ?? undefined,
    isTemplate: doc.isTemplate,
    isPredefined: doc.isPredefined,
    createdBy: doc.createdBy.toString(),
    instruction: doc.instruction ?? undefined,
    chunks: doc.chunks,
    hybridSearch: doc.hybridSearch,
    ragType: doc.ragType,
    maxToken: doc.maxToken,
    topK: doc.topK,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function sessionDocToRecord(doc: UploadSessionDocument): UploadSessionRecord {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    userId: doc.userId.toString(),
    status: doc.status,
    files: doc.files.map((f) => ({
      index: f.index,
      filename: f.filename,
      mimeType: f.mimeType,
      size: f.size,
      documentId: f.documentId?.toString(),
      uploadUrl: f.uploadUrl ?? undefined,
      status: f.status,
      progress: f.progress,
      error: f.error ?? undefined,
    })),
    totalFiles: doc.totalFiles,
    totalSize: doc.totalSize,
    completedFiles: doc.completedFiles,
    failedFiles: doc.failedFiles,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}
