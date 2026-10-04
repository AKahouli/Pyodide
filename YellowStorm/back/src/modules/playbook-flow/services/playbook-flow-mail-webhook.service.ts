import { Injectable } from '@nestjs/common';
import { PlaybookFlowMailGraphClientService } from './playbook-flow-mail-graph-client.service';
import { PlaybookFlowMailTriggerOrchestrationService } from './playbook-flow-mail-trigger-orchestration.service';
import { PlaybookFlowMailTriggerHandoffService } from './playbook-flow-mail-trigger-handoff.service';
import { FlowNormalizedMailEventData, FlowMailMessageAttachmentData } from '../interfaces/playbook-flow-mail.interface';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { LoggerService } from '@modules/logger';
import { FlowRepository, type FlowTriggerRef } from '../persistence/flow.repository';
import { MailEventLedgerRepository } from '../persistence/mail-event-ledger.repository';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

@Injectable()
export class PlaybookFlowMailWebhookService {
  constructor(
    private readonly flows: FlowRepository,
    private readonly ledger: MailEventLedgerRepository,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly orchestrationService: PlaybookFlowMailTriggerOrchestrationService,
    private readonly handoffService: PlaybookFlowMailTriggerHandoffService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowMailWebhookService'); }

  async handleNotifications(payload: { value?: Record<string, any>[] }) {
    const results: Record<string, any>[] = [];

    for (const item of Array.isArray(payload?.value) ? payload.value : []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const subscriptionId = item.subscriptionId;
      const clientState = item.clientState;
      const resource = typeof item.resource === 'string' ? item.resource : undefined;
      const resourceData = (item.resourceData || {}) as Record<string, any>;
      const messageId = resourceData.id;
      if (typeof subscriptionId !== 'string' || !subscriptionId ||
          typeof clientState !== 'string' || !clientState ||
          typeof messageId !== 'string' || !messageId) continue;

      const flow = await this.findFlowBySubscription(subscriptionId, clientState);
      if (!flow) continue;

      try {
        const graphMessage = await this.graphClient.getMessageByResource(
          flow.ownerId,
          this.getMailboxAppKey(flow),
          resource || `/me/messages/${encodeURIComponent(messageId)}`,
        );

        const normalizedEvent = this.normalizeMessage(flow, graphMessage);
        const evaluation = await this.orchestrationService.ingestAndEvaluate(flow.id, normalizedEvent);

        this.logger.log('Mail trigger evaluation complete', {
          flowId: flow.id,
          finalStatus: evaluation.finalStatus,
          matched: evaluation.match.matched,
          reasons: evaluation.match.reasons,
        });

        if (
          evaluation.finalStatus === 'matched' &&
          !evaluation.ingestion.duplicate &&
          graphMessage.hasAttachments === true &&
          this.isAttachmentImportEnabled(flow)
        ) {
          const workspaceId = flow.workspaces?.[0] ?? null;
          const attachments = await this.importAttachments(
            flow.ownerId,
            this.getMailboxAppKey(flow),
            graphMessage.id,
            workspaceId,
            this.getAllowedExtensions(flow),
          );

          await this.ledger.setAttachments(evaluation.ingestion.entry.id, attachments);
        }

        const handoff = evaluation.finalStatus === 'matched'
          ? await this.handoffService.handoffMatchedEvent(
            flow.id,
            flow.ownerId,
            evaluation.ingestion.entry.id,
          )
          : { executionId: null, handedOff: false, skippedReason: 'not-matched' as const };

        results.push({ subscriptionId, flowId: flow.id, evaluation, handoff });
      } catch (err) {
        this.logger.error('Mail notification processing failed', {
          subscriptionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { processed: results.length, results };
  }

  private async findFlowBySubscription(subscriptionId: string, clientState: string): Promise<FlowTriggerRef | null> {
    const [flow] = await this.flows.listByTrigger('mail', {
      enabled: true,
      subscriptionId,
      subscriptionClientState: clientState,
    });

    if (!flow) return null;
    const params = flow.triggerConfig?.params ?? {};
    if (params.subscriptionId !== subscriptionId || params.subscriptionClientState !== clientState) return null;
    return flow;
  }

  private getMailboxAppKey(flow: any): string {
    const params = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;
    return (params.mailboxAppKey as string) || '';
  }

  private isAttachmentImportEnabled(flow: any): boolean {
    const params = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;
    return params.attachmentImportEnabled === true;
  }

  private getAllowedExtensions(flow: any): string[] {
    const params = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;
    const exts = params.allowedAttachmentExtensions;
    return Array.isArray(exts) ? exts.map(String) : [];
  }

  private normalizeMessage(flow: any, msg: any): FlowNormalizedMailEventData {
    return {
      provider: 'm365',
      mailboxAppKey: this.getMailboxAppKey(flow),
      providerMessageId: msg.id,
      providerThreadId: msg.conversationId ?? null,
      receivedAt: msg.receivedDateTime,
      occurredAt: msg.receivedDateTime,
      subject: msg.subject ?? '',
      bodyText: msg.bodyPreview ?? '',
      bodyHtml: msg.body?.content ?? null,
      from: {
        name: msg.from?.emailAddress?.name ?? null,
        address: msg.from?.emailAddress?.address ?? '',
      },
      to: (msg.toRecipients || []).map((e: any) => ({
        name: e?.emailAddress?.name ?? null,
        address: e?.emailAddress?.address ?? '',
      })),
      cc: (msg.ccRecipients || []).map((e: any) => ({
        name: e?.emailAddress?.name ?? null,
        address: e?.emailAddress?.address ?? '',
      })),
      hasAttachments: msg.hasAttachments === true,
      attachments: [],
    };
  }

  private async importAttachments(
    userId: string,
    mailboxAppKey: string,
    graphMessageId: string,
    workspaceId: string | null,
    allowedExtensions: string[],
  ): Promise<FlowMailMessageAttachmentData[]> {
    const results: FlowMailMessageAttachmentData[] = [];

    let attachmentList: Record<string, any>[];
    try {
      attachmentList = await this.graphClient.listAttachments(userId, mailboxAppKey, graphMessageId);
    } catch (err) {
      this.logger.warn('Failed to list attachments', {
        graphMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
      return results;
    }

    for (const att of attachmentList) {
      const attId = String(att.id ?? '');
      const filename = String(att.name ?? 'unnamed');
      const mimeType = String(att.contentType ?? 'application/octet-stream');
      const size = typeof att.size === 'number' ? att.size : null;
      const extension = filename.includes('.') ? filename.split('.').pop()!.trim().toLowerCase() : '';
      const normalizedAllowed = allowedExtensions.map((e) => e.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);

      if (normalizedAllowed.length > 0 && !normalizedAllowed.includes(extension)) {
        results.push({
          providerAttachmentId: attId, filename, mimeType, size, isInline: false,
          workspaceImport: { workspaceDocumentId: null, filename, finalFilename: null, mimeType, size, sourcePath: null, collisionResolved: false, error: `Extension .${extension || 'unknown'} not allowed` },
        });
        continue;
      }

      if (!workspaceId || (size !== null && size > MAX_ATTACHMENT_SIZE)) {
        const err = !workspaceId ? 'No workspace configured' : 'Exceeds 10MB limit';
        results.push({
          providerAttachmentId: attId, filename, mimeType, size, isInline: false,
          workspaceImport: { workspaceDocumentId: null, filename, finalFilename: null, mimeType, size, sourcePath: null, collisionResolved: false, error: err },
        });
        continue;
      }

      try {
        const buffer = await this.graphClient.downloadAttachment(userId, mailboxAppKey, graphMessageId, attId);
        const doc = await this.workspaceDocumentService.uploadSmallFile(workspaceId, userId, buffer, filename, mimeType);
        results.push({
          providerAttachmentId: attId, filename, mimeType, size: buffer.length, isInline: false,
          workspaceImport: { workspaceDocumentId: doc.id, filename: doc.originalName, finalFilename: doc.filename ?? null, mimeType: doc.mimeType, size: doc.size, sourcePath: doc.path ?? null, collisionResolved: doc.originalName !== filename, error: null },
        });
      } catch (err) {
        results.push({
          providerAttachmentId: attId, filename, mimeType, size, isInline: false,
          workspaceImport: { workspaceDocumentId: null, filename, finalFilename: null, mimeType, size, sourcePath: null, collisionResolved: false, error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    return results;
  }
}
