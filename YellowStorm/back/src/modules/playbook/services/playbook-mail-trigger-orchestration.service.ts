import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import {
  PlaybookMailEventLedger,
  PlaybookMailEventLedgerDocument,
} from '../schemas/playbook-mail-event-ledger.schema';
import {
  MailTriggerEvaluationResultData,
  NormalizedMailEventData,
  PlaybookMailTriggerFiltersData,
} from '../interfaces/playbook.interface';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { PlaybookMailEventIngestionService } from './playbook-mail-event-ingestion.service';
import { PlaybookMailTriggerMatcherService } from './playbook-mail-trigger-matcher.service';

@Injectable()
export class PlaybookMailTriggerOrchestrationService {
  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    @InjectModel(PlaybookMailEventLedger.name)
    private readonly ledgerModel: Model<PlaybookMailEventLedgerDocument>,
    private readonly ingestionService: PlaybookMailEventIngestionService,
    private readonly matcherService: PlaybookMailTriggerMatcherService,
  ) {}

  async ingestAndEvaluate(playbookId: string, event: NormalizedMailEventData): Promise<MailTriggerEvaluationResultData> {
    const playbook = await this.playbookModel.findById(playbookId).select('mailTrigger').lean().exec();

    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const ingestion = await this.ingestionService.ingest(playbookId, event);

    if (ingestion.duplicate) {
      return {
        ingestion,
        match: { matched: ingestion.entry.status === 'matched', reasons: [] },
        finalStatus: ingestion.entry.status,
      };
    }

    const filters: PlaybookMailTriggerFiltersData = {
      from: Array.isArray(playbook.mailTrigger?.filters?.from) ? playbook.mailTrigger.filters.from : [],
      subjectContains: Array.isArray(playbook.mailTrigger?.filters?.subjectContains)
        ? playbook.mailTrigger.filters.subjectContains
        : [],
      bodyContains: Array.isArray(playbook.mailTrigger?.filters?.bodyContains)
        ? playbook.mailTrigger.filters.bodyContains
        : [],
      hasAttachments:
        typeof playbook.mailTrigger?.filters?.hasAttachments === 'boolean'
          ? playbook.mailTrigger.filters.hasAttachments
          : null,
    };

    const match = this.matcherService.match(filters, event);
    const finalStatus = match.matched ? 'matched' : 'ignored';

    await this.ledgerModel
      .updateOne(
        { id: ingestion.entry.id },
        {
          $set: {
            status: finalStatus,
            error: match.matched ? null : match.reasons.join(','),
          },
        },
      )
      .exec();

    return {
      ingestion: {
        ...ingestion,
        entry: {
          ...ingestion.entry,
          status: finalStatus,
          error: match.matched ? null : match.reasons.join(','),
        },
      },
      match,
      finalStatus,
    };
  }
}
