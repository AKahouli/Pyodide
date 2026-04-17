import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PlaybookMailEventLedger,
  PlaybookMailEventLedgerDocument,
} from '../schemas/playbook-mail-event-ledger.schema';
import {
  MailTriggerHandoffResultData,
  PlaybookMailTriggerNodeInputData,
} from '../interfaces/playbook.interface';
import { PlaybookExecutionService } from './playbook-execution.service';

@Injectable()
export class PlaybookMailTriggerHandoffService {
  constructor(
    @InjectModel(PlaybookMailEventLedger.name)
    private readonly ledgerModel: Model<PlaybookMailEventLedgerDocument>,
    private readonly executionService: PlaybookExecutionService,
  ) {}

  async handoffMatchedEvent(
    playbookId: string,
    userId: string,
    userEmail: string,
    ledgerEntryId: string,
  ): Promise<MailTriggerHandoffResultData> {
    const ledgerEntry = await this.ledgerModel.findOne({ id: ledgerEntryId, playbookId }).lean().exec();

    if (!ledgerEntry) {
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
        },
      },
    );

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
