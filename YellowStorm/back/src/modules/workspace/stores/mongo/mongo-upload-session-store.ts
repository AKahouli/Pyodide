import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import {
  UploadSession,
  UploadSessionDocument,
  UploadSessionStatus,
} from '../../schemas/upload-session.schema';
import { UPLOAD_SESSION_STORE, type UploadSessionStore, type UploadSessionCreateInput, type UploadSessionRecord } from '../upload-session-store';
import { sessionDocToRecord, toObjectId } from './mongo-store-mappers';

@Injectable()
export class MongoUploadSessionStore implements UploadSessionStore {
  constructor(
    @InjectModel(UploadSession.name)
    private readonly uploadSessionModel: Model<UploadSessionDocument>,
  ) {}

  async create(input: UploadSessionCreateInput): Promise<UploadSessionRecord> {
    const session = await this.uploadSessionModel.create({
      workspaceId: toObjectId(input.workspaceId),
      userId: toObjectId(input.userId),
      status: input.status,
      files: input.files.map((f) => ({
        index: f.index,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
        documentId: f.documentId ? new Types.ObjectId(f.documentId) : undefined,
        uploadUrl: f.uploadUrl,
        status: f.status,
        progress: f.progress,
      })),
      totalFiles: input.totalFiles,
      totalSize: input.totalSize,
      completedFiles: input.completedFiles,
      failedFiles: input.failedFiles,
      expiresAt: input.expiresAt,
    });
    return sessionDocToRecord(session);
  }

  async findByIdWorkspaceUser(sessionId: string, workspaceId: string, userId: string): Promise<UploadSessionRecord | null> {
    const session = await this.uploadSessionModel.findOne({
      _id: sessionId,
      workspaceId: toObjectId(workspaceId),
      userId: toObjectId(userId),
    });
    return session ? sessionDocToRecord(session) : null;
  }

  async findExpired(now: Date): Promise<UploadSessionRecord[]> {
    const expiredSessions = await this.uploadSessionModel.find({
      expiresAt: { $lt: now },
      status: { $in: [UploadSessionStatus.PENDING, UploadSessionStatus.IN_PROGRESS] },
    });
    return expiredSessions.map(sessionDocToRecord);
  }

  async updateFileProgress(sessionId: string, fileIndex: number, patch: { status?: string; progress?: number; error?: string }): Promise<void> {
    const session = await this.uploadSessionModel.findOne({ _id: sessionId });
    if (!session) return;
    const file = session.files[fileIndex];
    if (!file) return;
    if (patch.status !== undefined) file.status = patch.status;
    if (patch.progress !== undefined) file.progress = patch.progress;
    if (patch.error !== undefined) file.error = patch.error;
    await session.save();
  }

  async setStatus(sessionId: string, status: string): Promise<void> {
    const session = await this.uploadSessionModel.findOne({ _id: sessionId });
    if (!session) return;
    session.status = status as UploadSessionStatus;
    await session.save();
  }

  async setOutcome(sessionId: string, outcome: { status: string; completedFiles: number; failedFiles: number }): Promise<void> {
    const session = await this.uploadSessionModel.findOne({ _id: sessionId });
    if (!session) return;
    session.status = outcome.status as UploadSessionStatus;
    session.completedFiles = outcome.completedFiles;
    session.failedFiles = outcome.failedFiles;
    await session.save();
  }

  async markExpired(sessionId: string): Promise<void> {
    const session = await this.uploadSessionModel.findOne({ _id: sessionId });
    if (!session) return;
    session.status = UploadSessionStatus.EXPIRED;
    await session.save();
  }

  async deleteManyByWorkspace(workspaceId: string): Promise<void> {
    await this.uploadSessionModel.deleteMany({
      workspaceId: toObjectId(workspaceId),
    });
  }
}
