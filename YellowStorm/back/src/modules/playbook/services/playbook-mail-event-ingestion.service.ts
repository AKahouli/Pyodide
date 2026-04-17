import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import {
  PlaybookMailEventLedger,
  PlaybookMailEventLedgerDocument,
} from '../schemas/playbook-mail-event-ledger.schema';
import {
  MailEventIngestionResultData,
  MailEventLedgerEntryData,
  NormalizedMailEventData,
} from '../interfaces/playbook.interface';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { PlaybookMailEventLedgerService } from './playbook-mail-event-ledger.service';

@Injectable()
export class PlaybookMailEventIngestionService {
  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    @InjectModel(PlaybookMailEventLedger.name)
    private readonly ledgerModel: Model<PlaybookMailEventLedgerDocument>,
    private readonly ledgerService: PlaybookMailEventLedgerService,
  ) {}

  async ingest(playbookId: string, event: NormalizedMailEventData): Promise<MailEventIngestionResultData> {
    const playbook = await this.playbookModel.findById(playbookId).select('_id').lean().exec();

    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const entry = this.ledgerService.createLedgerEntry(event);

    try {
      await this.ledgerModel.create({
        id: entry.id,
        playbookId: playbook._id,
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
          .findOne({ playbookId: playbook._id, dedupeKey: entry.dedupeKey })
          .lean()
          .exec();

        return {
          duplicate: true,
          entry: this.mapEntry(duplicateEntry),
        };
      }

      throw error;
    }

    return {
      duplicate: false,
      entry,
    };
  }

  private mapEntry(entry: any): MailEventLedgerEntryData {
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
