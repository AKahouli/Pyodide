import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernancePublicationAttempt, GovernancePublicationAttemptDocument } from './schemas/governance-publication-attempt.schema';
import { PUBLICATION_ATTEMPT_STORE, type GovernancePublicationAttemptCreateInput, type PublicationAttemptStore } from '../publication-attempt-store';
import type { GovernancePublicationAttemptRecord } from '../governance-records';

export function publicationAttemptToRecord(doc: Record<string, unknown>): GovernancePublicationAttemptRecord {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docAny = doc as any;  return {
    id: docAny._id.toString(),
    programId: docAny.programId.toString(),
    scopeId: docAny.scopeId.toString(),
    deploymentId: docAny.deploymentId.toString(),
    revisionId: docAny.revisionId?.toString(),
    triggeredByUserId: docAny.triggeredByUserId.toString(),
    triggeredByEmail: docAny.triggeredByEmail,
    requestedChannels: docAny.requestedChannels ?? [],
    allowPartial: docAny.allowPartial,
    comment: docAny.comment,
    status: docAny.status,
    readinessSnapshot: docAny.readinessSnapshot ?? {},
    errorCode: docAny.errorCode,
    errorMessage: docAny.errorMessage,
    createdAt: docAny.createdAt,
    updatedAt: docAny.updatedAt,
  };
}

@Injectable()
export class MongoPublicationAttemptStore implements PublicationAttemptStore {
  constructor(@InjectModel(GovernancePublicationAttempt.name) private readonly model: Model<GovernancePublicationAttemptDocument>) {}

  async insert(input: GovernancePublicationAttemptCreateInput): Promise<GovernancePublicationAttemptRecord> {
    const created = await this.model.create({
      ...input,
      programId: new Types.ObjectId(input.programId),
      scopeId: new Types.ObjectId(input.scopeId),
      deploymentId: new Types.ObjectId(input.deploymentId),
      revisionId: input.revisionId ? new Types.ObjectId(input.revisionId) : undefined,
      triggeredByUserId: new Types.ObjectId(input.triggeredByUserId),
    });
    return publicationAttemptToRecord(created as unknown as Record<string, unknown>);
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.model.deleteMany({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).exec();
  }
}
