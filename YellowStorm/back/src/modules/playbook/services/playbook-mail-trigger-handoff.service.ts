import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlaybookMailEventLedger,
  PlaybookMailEventLedgerDocument,
} from '../schemas/playbook-mail-event-ledger.schema';
import {
  MailTriggerHandoffResultData,
  PlaybookMailTriggerNodeInputData,
} from '../interfaces/playbook.interface';
import { PlaybookExecutionService } from './playbook-execution.service';
import { LoggerService } from '../../logger';

@Injectable()
export class PlaybookMailTriggerHandoffService {
  constructor(
    @InjectModel(PlaybookMailEventLedger.name)
    private readonly ledgerModel: Model<PlaybookMailEventLedgerDocument>,
    private readonly executionService: PlaybookExecutionService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaybookMailTriggerHandoffService.name);
  }

  async handoffMatchedEvent(
    playbookId: string,
    userId: string,
    userEmail: string,
    ledgerEntryId: string,
  ): Promise<MailTriggerHandoffResultData> {
    const playbookObjectId = Types.ObjectId.isValid(playbookId) ? new Types.ObjectId(playbookId) : playbookId;
    const ledgerEntry = await this.ledgerModel
      .findOne({ id: ledgerEntryId, playbookId: playbookObjectId })
      .lean()
      .exec();

    if (!ledgerEntry) {
      const byIdOnly = await this.ledgerModel.findOne({ id: ledgerEntryId }).lean().exec();
      this.logger.warn('Handoff: ledger entry not found with playbookId filter', {
        ledgerEntryId,
        playbookId,
        playbookObjectId: String(playbookObjectId),
        foundWithoutFilter: !!byIdOnly,
        foundEntryStatus: byIdOnly?.status ?? 'n/a',
        foundEntryPlaybookId: byIdOnly ? String(byIdOnly.playbookId) : 'n/a',
      });
      return { executionId: null, handedOff: false, skippedReason: 'not-matched' };
    }

    if (ledgerEntry.status === 'handed_off' && ledgerEntry.executionId) {
      return {
        executionId: ledgerEntry.executionId,
        handedOff: false,
        skippedReason: 'already-handed-off',
      };
    }

    if (ledgerEntry.status !== 'matched') {
      this.logger.warn('Handoff: ledger entry status is not matched', {
        ledgerEntryId,
        status: ledgerEntry.status,
      });
      return { executionId: null, handedOff: false, skippedReason: 'not-matched' };
    }

    const triggerPayload: PlaybookMailTriggerNodeInputData = {
      trigger: {
        type: 'mail',
        occurredAt: ledgerEntry.occurredAt?.toISOString?.() ?? ledgerEntry.occurredAt,
      },
      message: {
        provider: ledgerEntry.provider,
        mailboxAppKey: ledgerEntry.mailboxAppKey,
        providerMessageId: ledgerEntry.providerMessageId,
        providerThreadId: ledgerEntry.providerThreadId ?? null,
        receivedAt: ledgerEntry.receivedAt?.toISOString?.() ?? ledgerEntry.receivedAt,
        subject: ledgerEntry.subject ?? '',
        bodyText: ledgerEntry.bodyText ?? '',
        bodyHtml: ledgerEntry.bodyHtml ?? null,
        from: ledgerEntry.from,
        to: Array.isArray(ledgerEntry.to) ? ledgerEntry.to : [],
        cc: Array.isArray(ledgerEntry.cc) ? ledgerEntry.cc : [],
        hasAttachments: ledgerEntry.hasAttachments === true,
        attachments: Array.isArray(ledgerEntry.attachments) ? ledgerEntry.attachments : [],
      },
    };

    const triggerPorts = {
      mail_data: {
        kind: 'data' as const,
        value: {
          receivedAt: triggerPayload.message.receivedAt,
          from: triggerPayload.message.from,
          to: triggerPayload.message.to,
          cc: triggerPayload.message.cc,
          subject: triggerPayload.message.subject,
          bodyText: triggerPayload.message.bodyText,
          bodyHtml: triggerPayload.message.bodyHtml,
          hasAttachments: triggerPayload.message.hasAttachments,
          providerMessageId: triggerPayload.message.providerMessageId,
          providerThreadId: triggerPayload.message.providerThreadId,
        },
      },
      mail_attachments: {
        kind: 'document' as const,
        documentIds: triggerPayload.message.attachments
          .map((attachment) => attachment.workspaceImport?.workspaceDocumentId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      },
    };

    this.logger.log('Handoff: triggering playbook execution', {
      playbookId,
      userId,
      subject: triggerPayload.message.subject,
    });

    const execution = await this.executionService.executePlaybook(
      userId,
      playbookId,
      { query: ledgerEntry.subject || '' } as any,
      userEmail,
      {
        executionTrigger: 'mail',
        triggerContext: {
          type: 'mail',
          occurredAt: triggerPayload.trigger.occurredAt,
          payload: triggerPayload,
          ports: triggerPorts,
        },
      },
    );

    this.logger.log('Handoff: execution created', { executionId: execution.executionId });

    const updateResult = await this.ledgerModel
      .updateOne(
        { id: ledgerEntryId, status: 'matched' },
        {
          $set: {
            status: 'handed_off',
            executionId: execution.executionId,
            error: null,
          },
        },
      )
      .exec();

    if ((updateResult as any)?.modifiedCount === 0) {
      return {
        executionId: execution.executionId,
        handedOff: false,
        skippedReason: 'duplicate',
      };
    }

    return {
      executionId: execution.executionId,
      handedOff: true,
      skippedReason: null,
    };
  }
}
