import { Injectable } from '@nestjs/common';
import {
  FlowMailEventIngestionResultData,
  FlowNormalizedMailEventData,
  FlowMailEventLedgerEntryData,
} from '../interfaces/playbook-flow-mail.interface';
import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowMailEventLedgerService } from './playbook-flow-mail-event-ledger.service';
import { FlowRepository } from '../persistence/flow.repository';
import { MailEventLedgerRepository, type MailEventLedgerRecord } from '../persistence/mail-event-ledger.repository';

@Injectable()
export class PlaybookFlowMailEventIngestionService {
  constructor(
    private readonly flows: FlowRepository,
    private readonly ledger: MailEventLedgerRepository,
    private readonly ledgerService: PlaybookFlowMailEventLedgerService,
  ) {}

  async ingest(
    flowId: string,
    event: FlowNormalizedMailEventData,
  ): Promise<FlowMailEventIngestionResultData> {
    const flow = await this.flows.findOwnerRef(flowId);
    if (!flow) throw new NotFoundException('Flow not found');

    const entry = this.ledgerService.createLedgerEntry(event);

    const created = await this.ledger.insertIfNew({
      ledgerId: entry.id,
      flowId: flow.id,
      dedupeKey: entry.dedupeKey,
      status: entry.status,
      provider: entry.event.provider,
      mailboxAppKey: entry.event.mailboxAppKey,
      providerMessageId: entry.event.providerMessageId,
      providerThreadId: entry.event.providerThreadId,
      receivedAt: new Date(entry.event.receivedAt),
      occurredAt: new Date(entry.event.occurredAt),
      subject: entry.event.subject,
      bodyText: entry.event.bodyText,
      bodyHtml: entry.event.bodyHtml,
      from: entry.event.from,
      to: entry.event.to,
      cc: entry.event.cc,
      hasAttachments: entry.event.hasAttachments,
      attachments: entry.event.attachments,
      error: entry.error,
      createdAt: new Date(entry.createdAt),
    });
    if (!created) {
      const duplicateEntry = await this.ledger.findByDedupeKey(flow.id, entry.dedupeKey);
      return { duplicate: true, entry: this.mapEntry(duplicateEntry!) };
    }

    return { duplicate: false, entry };
  }

  private mapEntry(entry: MailEventLedgerRecord): FlowMailEventLedgerEntryData {
    return {
      id: entry.ledgerId,
      dedupeKey: entry.dedupeKey,
      status: entry.status,
      event: {
        provider: entry.provider as FlowNormalizedMailEventData['provider'],
        mailboxAppKey: entry.mailboxAppKey,
        providerMessageId: entry.providerMessageId,
        providerThreadId: entry.providerThreadId ?? null,
        receivedAt: entry.receivedAt.toISOString(),
        occurredAt: entry.occurredAt.toISOString(),
        subject: entry.subject ?? '',
        bodyText: entry.bodyText ?? '',
        bodyHtml: entry.bodyHtml ?? null,
        from: entry.from,
        to: Array.isArray(entry.to) ? entry.to : [],
        cc: Array.isArray(entry.cc) ? entry.cc : [],
        hasAttachments: entry.hasAttachments === true,
        attachments: Array.isArray(entry.attachments) ? entry.attachments : [],
      },
      error: entry.error ?? null,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}
