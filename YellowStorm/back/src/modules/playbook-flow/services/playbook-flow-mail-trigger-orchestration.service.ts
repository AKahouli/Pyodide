import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import {
  FlowMailEventLedger,
  FlowMailEventLedgerDocument,
} from '../schemas/playbook-flow-mail-event-ledger.schema';
import { FlowMailTriggerConfig } from '../schemas/playbook-flow-trigger.schema';
import {
  FlowMailTriggerEvaluationResultData,
  FlowNormalizedMailEventData,
  FlowMailTriggerFiltersData,
} from '../interfaces/playbook-flow-mail.interface';
import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowMailEventIngestionService } from './playbook-flow-mail-event-ingestion.service';
import { PlaybookFlowMailTriggerMatcherService } from './playbook-flow-mail-trigger-matcher.service';

@Injectable()
export class PlaybookFlowMailTriggerOrchestrationService {
  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    @InjectModel(FlowMailEventLedger.name) private readonly ledgerModel: Model<FlowMailEventLedgerDocument>,
    private readonly ingestionService: PlaybookFlowMailEventIngestionService,
    private readonly matcherService: PlaybookFlowMailTriggerMatcherService,
  ) {}

  async ingestAndEvaluate(
    flowId: string,
    event: FlowNormalizedMailEventData,
  ): Promise<FlowMailTriggerEvaluationResultData> {
    const flow = await this.flowModel.findById(flowId).select('triggerConfig').lean().exec();
    if (!flow) throw new NotFoundException('Flow not found');

    const ingestion = await this.ingestionService.ingest(flowId, event);

    if (ingestion.duplicate) {
      return {
        ingestion,
        match: { matched: ingestion.entry.status === 'matched', reasons: [] },
        finalStatus: ingestion.entry.status,
      };
    }

    const mailConfig = this.extractMailConfig(flow.triggerConfig?.params);
    const filters = this.extractFilters(mailConfig);

    const match = this.matcherService.match(filters, event);
    const finalStatus = match.matched ? 'matched' : 'ignored';

    await this.ledgerModel
      .updateOne(
        { id: ingestion.entry.id },
        { $set: { status: finalStatus, error: match.matched ? null : match.reasons.join(',') } },
      )
      .exec();

    return {
      ingestion: {
        ...ingestion,
        entry: { ...ingestion.entry, status: finalStatus, error: match.matched ? null : match.reasons.join(',') },
      },
      match,
      finalStatus,
    };
  }

  private extractMailConfig(params: Record<string, unknown> | undefined): FlowMailTriggerConfig | null {
    if (!params) return null;
    const cfg = params['mail'] ?? params['mailTrigger'] ?? null;
    if (!cfg || typeof cfg !== 'object') return null;
    return cfg as unknown as FlowMailTriggerConfig;
  }

  private extractFilters(config: FlowMailTriggerConfig | null): FlowMailTriggerFiltersData {
    if (!config?.filters) {
      return { from: [], subjectContains: [], bodyContains: [], hasAttachments: null };
    }
    return {
      from: Array.isArray(config.filters.from) ? config.filters.from : [],
      subjectContains: Array.isArray(config.filters.subjectContains) ? config.filters.subjectContains : [],
      bodyContains: Array.isArray(config.filters.bodyContains) ? config.filters.bodyContains : [],
      hasAttachments: typeof config.filters.hasAttachments === 'boolean' ? config.filters.hasAttachments : null,
    };
  }
}
