import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { KnowledgePriority } from '../domain/knowledge-steward';
import { KnowledgeAlert, KnowledgeAlertDocument, type KnowledgeAlertCategory, type KnowledgeAlertStatus } from '../schemas/knowledge-alert.schema';

export interface KnowledgeAlertInput { programId: string; scopeIds: string[]; documentId: string; category: KnowledgeAlertCategory; severity: KnowledgePriority; title: string; description: string; deduplicationKey: string; evidenceRefs: string[]; }

@Injectable()
export class KnowledgeAlertRepositoryService {
  constructor(@InjectModel(KnowledgeAlert.name) private readonly model: Model<KnowledgeAlertDocument>) {}

  async synchronize(documentId: string, alerts: KnowledgeAlertInput[], now: Date): Promise<KnowledgeAlertDocument[]> {
    const activeKeys = alerts.map((alert) => alert.deduplicationKey);
    await Promise.all(alerts.map((alert) => this.model.findOneAndUpdate(
      { programId: new Types.ObjectId(alert.programId), deduplicationKey: alert.deduplicationKey },
      { $set: { scopeIds: alert.scopeIds.map((id) => new Types.ObjectId(id)), documentId: new Types.ObjectId(alert.documentId), category: alert.category, severity: alert.severity, title: alert.title, description: alert.description, evidenceRefs: alert.evidenceRefs }, $setOnInsert: { programId: new Types.ObjectId(alert.programId), deduplicationKey: alert.deduplicationKey, status: 'open', openedAt: now } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).exec()));
    await this.model.updateMany({ documentId: new Types.ObjectId(documentId), status: { $in: ['open', 'acknowledged'] }, deduplicationKey: { $nin: activeKeys } }, { $set: { status: 'resolved', resolvedAt: now } }).exec();
    return this.model.find({ documentId: new Types.ObjectId(documentId), deduplicationKey: { $in: activeKeys } }).exec();
  }

  async list(programId: string, filter: { scopeIds?: string[]; status?: KnowledgeAlertStatus; category?: KnowledgeAlertCategory; severity?: KnowledgePriority }): Promise<KnowledgeAlertDocument[]> {
    const query: Record<string, unknown> = { programId: new Types.ObjectId(programId) };
    if (filter.scopeIds && !filter.scopeIds.includes('*')) query.$or = [{ scopeIds: { $in: filter.scopeIds.map((id) => new Types.ObjectId(id)) } }, { scopeIds: { $size: 0 } }];
    if (filter.status) query.status = filter.status;
    if (filter.category) query.category = filter.category;
    if (filter.severity) query.severity = filter.severity;
    return this.model.find(query).sort({ status: 1, severity: 1, openedAt: -1 }).limit(500).exec();
  }

  async acknowledge(programId: string, alertId: string, actorId: string, accessibleScopeIds: string[]): Promise<KnowledgeAlertDocument | null> {
    const scopeFilter = accessibleScopeIds.includes('*') ? {} : { $or: [{ scopeIds: { $in: accessibleScopeIds.map((id) => new Types.ObjectId(id)) } }, { scopeIds: { $size: 0 } }] };
    return this.model.findOneAndUpdate({ _id: new Types.ObjectId(alertId), programId: new Types.ObjectId(programId), status: 'open', ...scopeFilter }, { $set: { status: 'acknowledged', acknowledgedBy: new Types.ObjectId(actorId), acknowledgedAt: new Date() } }, { new: true }).exec();
  }
}
