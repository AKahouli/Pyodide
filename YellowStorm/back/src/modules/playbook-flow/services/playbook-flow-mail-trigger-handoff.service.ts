import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FlowMailEventLedger,
  FlowMailEventLedgerDocument,
} from '../schemas/playbook-flow-mail-event-ledger.schema';
import { FlowMailTriggerHandoffResultData } from '../interfaces/playbook-flow-mail.interface';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { LoggerService } from '@modules/logger';

@Injectable()
export class PlaybookFlowMailTriggerHandoffService {
  constructor(
    @InjectModel(FlowMailEventLedger.name)
    private readonly ledgerModel: Model<FlowMailEventLedgerDocument>,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowMailTriggerHandoffService'); }

  async handoffMatchedEvent(
    flowId: string,
    userId: string,
    ledgerEntryId: string,
  ): Promise<FlowMailTriggerHandoffResultData> {
    const ledgerEntry = await this.ledgerModel
      .findOne({ id: ledgerEntryId, flowId })
      .lean()
      .exec();

    if (!ledgerEntry) {
      this.logger.warn('Handoff: ledger entry not found', { ledgerEntryId, flowId });
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
      this.logger.warn('Handoff: entry status not matched', { ledgerEntryId, status: ledgerEntry.status });
      return { executionId: null, handedOff: false, skippedReason: 'not-matched' };
    }

    const triggerContext = {
      type: 'mail',
      occurredAt: ledgerEntry.occurredAt?.toISOString?.() ?? ledgerEntry.occurredAt,
      mailEvent: {
        subject: ledgerEntry.subject,
        bodyText: ledgerEntry.bodyText,
        from: ledgerEntry.from,
        to: ledgerEntry.to,
        cc: ledgerEntry.cc,
        hasAttachments: ledgerEntry.hasAttachments,
        attachments: Array.isArray(ledgerEntry.attachments) ? ledgerEntry.attachments : [],
      },
    };

    const execution = await this.executionService.start(
      flowId,
      userId,
      { triggerContext },
    );

    const updateResult = await this.ledgerModel
      .updateOne(
        { id: ledgerEntryId, status: 'matched' },
        { $set: { status: 'handed_off', executionId: execution.id, error: null } },
      )
      .exec();

    if ((updateResult as any)?.modifiedCount === 0) {
      return { executionId: execution.id, handedOff: false, skippedReason: 'duplicate' };
    }

    return { executionId: execution.id, handedOff: true, skippedReason: null };
  }
}
