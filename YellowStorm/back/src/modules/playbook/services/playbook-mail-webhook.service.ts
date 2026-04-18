import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import { PlaybookMailEventLedger, PlaybookMailEventLedgerDocument } from '../schemas/playbook-mail-event-ledger.schema';
import { PlaybookMailGraphClientService } from './playbook-mail-graph-client.service';
import { PlaybookMailTriggerOrchestrationService } from './playbook-mail-trigger-orchestration.service';
import { PlaybookMailTriggerHandoffService } from './playbook-mail-trigger-handoff.service';
import { NormalizedMailEventData, MailMessageAttachmentData } from '../interfaces/playbook.interface';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { LoggerService } from '../../logger';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

@Injectable()
export class PlaybookMailWebhookService {
  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    @InjectModel(PlaybookMailEventLedger.name)
    private readonly ledgerModel: Model<PlaybookMailEventLedgerDocument>,
    private readonly graphClient: PlaybookMailGraphClientService,
    private readonly orchestrationService: PlaybookMailTriggerOrchestrationService,
    private readonly handoffService: PlaybookMailTriggerHandoffService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaybookMailWebhookService.name);
  }

  async handleNotifications(payload: { value?: Array<Record<string, any>> }) {
    const results: Array<Record<string, any>> = [];

    for (const item of payload.value || []) {
      const subscriptionId = item.subscriptionId as string | undefined;
      const resource = typeof item.resource === 'string' ? item.resource : undefined;
      const resourceData = (item.resourceData || {}) as Record<string, any>;
      const messageId = resourceData.id as string | undefined;
      if (!subscriptionId || !messageId) {
        continue;
      }

      const playbook = await this.playbookModel
        .findOne({ 'mailTrigger.subscriptionId': subscriptionId })
        .select('_id createdBy mailTrigger workspaces')
        .lean()
        .exec();

      if (
        !playbook ||
        !playbook.mailTrigger?.mailboxAppKey ||
        !playbook.mailTrigger?.subscriptionClientState ||
        item.clientState !== playbook.mailTrigger.subscriptionClientState
      ) {
        continue;
      }

      this.logger.log('Processing Graph mail notification', {
        subscriptionId,
        resource,
        resourceDataId: messageId,
      });

      try {
        const graphMessage = await this.graphClient.getMessageByResource(
          playbook.createdBy.toString(),
          playbook.mailTrigger.mailboxAppKey,
          resource || `/me/messages/${encodeURIComponent(messageId)}`,
        );

        const normalizedEvent: NormalizedMailEventData = {
          provider: 'm365',
          mailboxAppKey: playbook.mailTrigger.mailboxAppKey,
          providerMessageId: graphMessage.id,
          providerThreadId: graphMessage.conversationId ?? null,
          receivedAt: graphMessage.receivedDateTime,
          occurredAt: graphMessage.receivedDateTime,
          subject: graphMessage.subject ?? '',
          bodyText: graphMessage.bodyPreview ?? '',
          bodyHtml: graphMessage.body?.content ?? null,
          from: {
            name: graphMessage.from?.emailAddress?.name ?? null,
            address: graphMessage.from?.emailAddress?.address ?? '',
          },
          to: (graphMessage.toRecipients || []).map((entry: any) => ({
            name: entry?.emailAddress?.name ?? null,
            address: entry?.emailAddress?.address ?? '',
          })),
          cc: (graphMessage.ccRecipients || []).map((entry: any) => ({
            name: entry?.emailAddress?.name ?? null,
            address: entry?.emailAddress?.address ?? '',
          })),
          hasAttachments: graphMessage.hasAttachments === true,
          attachments: [],
        };

        this.logger.log('Mail event normalized', {
          playbookId: playbook._id.toString(),
          subject: normalizedEvent.subject,
          from: normalizedEvent.from.address,
          attachmentCount: 0,
        });

        const evaluation = await this.orchestrationService.ingestAndEvaluate(
          playbook._id.toString(),
          normalizedEvent,
        );

        this.logger.log('Mail trigger evaluation complete', {
          playbookId: playbook._id.toString(),
          finalStatus: evaluation.finalStatus,
          matched: evaluation.match.matched,
          duplicate: evaluation.ingestion.duplicate,
        });

        if (
          evaluation.finalStatus === 'matched'
          && evaluation.ingestion.duplicate === false
          && graphMessage.hasAttachments === true
          && playbook.mailTrigger?.attachmentImportEnabled === true
        ) {
          const workspaceId = playbook.workspaces?.[0]?.toString?.() ?? null;
          const attachments = await this.importAttachments(
            playbook.createdBy.toString(),
            playbook.mailTrigger.mailboxAppKey,
            graphMessage.id,
            workspaceId,
            Array.isArray(playbook.mailTrigger?.allowedAttachmentExtensions)
              ? playbook.mailTrigger.allowedAttachmentExtensions
              : [],
          );

          await this.ledgerModel
            .updateOne(
              { id: evaluation.ingestion.entry.id },
              { $set: { attachments } },
            )
            .exec();

          this.logger.log('Mail attachments persisted to ledger', {
            playbookId: playbook._id.toString(),
            ledgerEntryId: evaluation.ingestion.entry.id,
            attachmentCount: attachments.length,
          });
        }

        const handoff = evaluation.finalStatus === 'matched'
          ? await this.handoffService.handoffMatchedEvent(
            playbook._id.toString(),
            playbook.createdBy.toString(),
            '',
            evaluation.ingestion.entry.id,
          )
          : { executionId: null, handedOff: false, skippedReason: 'not-matched' };

        this.logger.log('Mail trigger handoff complete', {
          playbookId: playbook._id.toString(),
          handedOff: handoff.handedOff,
          executionId: handoff.executionId,
          skippedReason: handoff.skippedReason,
        });

        results.push({
          subscriptionId,
          playbookId: playbook._id.toString(),
          evaluation,
          handoff,
        });
      } catch (err) {
        this.logger.error('Mail notification processing failed', {
          subscriptionId,
          resource,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { processed: results.length, results };
  }

  private async importAttachments(
    userId: string,
    mailboxAppKey: string,
    graphMessageId: string,
    workspaceId: string | null,
    allowedExtensions: string[],
  ): Promise<MailMessageAttachmentData[]> {
    const results: MailMessageAttachmentData[] = [];

    let attachmentList: Array<Record<string, any>>;
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
      const normalizedAllowedExtensions = allowedExtensions
        .map((value) => value.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean);

      if (normalizedAllowedExtensions.length > 0 && !normalizedAllowedExtensions.includes(extension)) {
        results.push({
          providerAttachmentId: attId,
          filename,
          mimeType,
          size,
          isInline: false,
          workspaceImport: {
            workspaceDocumentId: null,
            filename,
            finalFilename: null,
            mimeType,
            size,
            sourcePath: null,
            collisionResolved: false,
            error: `Extension .${extension || 'unknown'} is not allowed`,
          },
        });
        continue;
      }

      if (!workspaceId) {
        results.push({
          providerAttachmentId: attId,
          filename,
          mimeType,
          size,
          isInline: false,
          workspaceImport: null,
        });
        continue;
      }

      if (size !== null && size > MAX_ATTACHMENT_SIZE) {
        this.logger.warn('Attachment too large, skipping import', { filename, size });
        results.push({
          providerAttachmentId: attId,
          filename,
          mimeType,
          size,
          isInline: false,
          workspaceImport: {
            workspaceDocumentId: null,
            filename,
            finalFilename: null,
            mimeType,
            size,
            sourcePath: null,
            collisionResolved: false,
            error: 'File exceeds 10MB limit',
          },
        });
        continue;
      }

      try {
        const buffer = await this.graphClient.downloadAttachment(userId, mailboxAppKey, graphMessageId, attId);
        const doc = await this.workspaceDocumentService.uploadSmallFile(
          workspaceId,
          userId,
          buffer,
          filename,
          mimeType,
        );

        this.logger.log('Attachment imported to workspace', {
          filename,
          documentId: doc.id,
          workspaceId,
        });

        results.push({
          providerAttachmentId: attId,
          filename,
          mimeType,
          size: buffer.length,
          isInline: false,
          workspaceImport: {
            workspaceDocumentId: doc.id,
            filename: doc.originalName,
            finalFilename: doc.filename,
            mimeType: doc.mimeType,
            size: doc.size,
            sourcePath: doc.path,
            collisionResolved: doc.originalName !== filename,
            error: null,
          },
        });
      } catch (err) {
        this.logger.warn('Attachment import failed', {
          filename,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({
          providerAttachmentId: attId,
          filename,
          mimeType,
          size,
          isInline: false,
          workspaceImport: {
            workspaceDocumentId: null,
            filename,
            finalFilename: null,
            mimeType,
            size,
            sourcePath: null,
            collisionResolved: false,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    return results;
  }
}
