import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

@Injectable()
export class WorkspaceArtifactCleanupService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  countBySource(workspaceId: string, documentId: string): Promise<number> {
    return this.connection.collection('workspace_artifacts').countDocuments({
      workspaceId: new Types.ObjectId(workspaceId),
      'primarySource.documentId': new Types.ObjectId(documentId),
    });
  }

  async deleteBySource(workspaceId: string, documentId: string): Promise<void> {
    await this.connection.collection('workspace_artifacts').deleteMany({
      workspaceId: new Types.ObjectId(workspaceId),
      'primarySource.documentId': new Types.ObjectId(documentId),
    });
  }

  async deleteAllByWorkspace(workspaceId: string): Promise<void> {
    await this.connection.collection('workspace_artifacts').deleteMany({
      workspaceId: new Types.ObjectId(workspaceId),
    });
  }
}
