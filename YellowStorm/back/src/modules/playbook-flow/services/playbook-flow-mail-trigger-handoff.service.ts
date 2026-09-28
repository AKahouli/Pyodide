import { Injectable } from '@nestjs/common';
import { FlowMailTriggerHandoffResultData } from '../interfaces/playbook-flow-mail.interface';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { LoggerService } from '@modules/logger';
import { MailEventLedgerRepository } from '../persistence/mail-event-ledger.repository';

@Injectable()
export class PlaybookFlowMailTriggerHandoffService {
  constructor(
    private readonly ledger: MailEventLedgerRepository,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowMailTriggerHandoffService'); }

  async handoffMatchedEvent(
    flowId: string,
    userId: string,
    ledgerEntryId: string,
  ): Promise<FlowMailTriggerHandoffResultData> {
    const ledgerEntry = await this.ledger.findByLedgerId(ledgerEntryId, flowId);

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
      occurredAt: ledgerEntry.occurredAt.toISOString(),
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
      {
        triggerContext,
        mail_data: triggerContext.mailEvent,
        mail_attachments: triggerContext.mailEvent.attachments,
      },
      `mail:${flowId}:${ledgerEntryId}`,
    );

    if (!(await this.ledger.markHandedOff(ledgerEntryId, execution.id))) {
      return { executionId: execution.id, handedOff: false, skippedReason: 'duplicate' };
    }

    return { executionId: execution.id, handedOff: true, skippedReason: null };
  }
}
