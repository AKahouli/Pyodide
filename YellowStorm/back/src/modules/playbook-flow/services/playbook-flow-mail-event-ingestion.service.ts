import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import {
  FlowMailEventLedger,
  FlowMailEventLedgerDocument,
} from '../schemas/playbook-flow-mail-event-ledger.schema';
import {
  FlowMailEventIngestionResultData,
  FlowNormalizedMailEventData,
  FlowMailEventLedgerEntryData,
} from '../interfaces/playbook-flow-mail.interface';
import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowMailEventLedgerService } from './playbook-flow-mail-event-ledger.service';

@Injectable()
export class PlaybookFlowMailEventIngestionService {
  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    @InjectModel(FlowMailEventLedger.name) private readonly ledgerModel: Model<FlowMailEventLedgerDocument>,
    private readonly ledgerService: PlaybookFlowMailEventLedgerService,
  ) {}

  async ingest(
    flowId: string,
    event: FlowNormalizedMailEventData,
  ): Promise<FlowMailEventIngestionResultData> {
    const flow = await this.flowModel.findById(flowId).select('_id').lean().exec();
    if (!flow) throw new NotFoundException('Flow not found');

    const entry = this.ledgerService.createLedgerEntry(event);

    try {
      await this.ledgerModel.create({
        id: entry.id,
        flowId: flow._id.toString(),
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
    } catch (error: any) {
      if (error?.code === 11000) {
        const duplicateEntry = await this.ledgerModel
          .findOne({ flowId: flow._id.toString(), dedupeKey: entry.dedupeKey })
          .lean()
          .exec();
        return { duplicate: true, entry: this.mapEntry(duplicateEntry) };
      }
      throw error;
    }

    return { duplicate: false, entry };
  }

  private mapEntry(entry: any): FlowMailEventLedgerEntryData {
    return {
      id: entry.id,
      dedupeKey: entry.dedupeKey,
      status: entry.status,
      event: {
        provider: entry.provider,
        mailboxAppKey: entry.mailboxAppKey,
        providerMessageId: entry.providerMessageId,
        providerThreadId: entry.providerThreadId ?? null,
        receivedAt: entry.receivedAt?.toISOString?.() ?? entry.receivedAt,
        occurredAt: entry.occurredAt?.toISOString?.() ?? entry.occurredAt,
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
      createdAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
    };
  }
}
