import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { WorkspaceDoc, type WorkspaceDocumentDoc } from '../../schemas/workspace-document.schema';
import {
  WORKSPACE_DOCUMENT_WRITE_PORT,
  type IndexingStatePatch,
  type WorkspaceDocumentWritePort,
} from '../../ports/workspace-document-write.port';

/**
 * Mongo implementation of the indexing write port. Persists through Mongoose
 * instance save() so validators, middleware and updatedAt behavior stay exactly
 * as they were when the service mutated hydrated documents directly.
 */
@Injectable()
export class MongoWorkspaceDocumentWriteAdapter implements WorkspaceDocumentWritePort {
  constructor(@InjectModel(WorkspaceDoc.name) private readonly documentModel: Model<WorkspaceDocumentDoc>) {}

  async updateIndexingState(id: string, patch: IndexingStatePatch): Promise<void> {
    const doc = await this.documentModel.findById(id).exec();
    if (!doc) return;
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc as any)[key] = value;
    }
    await doc.save();
  }
}
