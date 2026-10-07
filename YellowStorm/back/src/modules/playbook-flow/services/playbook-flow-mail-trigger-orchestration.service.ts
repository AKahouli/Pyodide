import { Injectable } from '@nestjs/common';
import {
  FlowMailTriggerEvaluationResultData,
  FlowNormalizedMailEventData,
  FlowMailTriggerFiltersData,
  FlowMailTriggerParamsData,
} from '../interfaces/playbook-flow-mail.interface';
import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowMailEventIngestionService } from './playbook-flow-mail-event-ingestion.service';
import { PlaybookFlowMailTriggerMatcherService } from './playbook-flow-mail-trigger-matcher.service';
import { FlowRepository } from '../persistence/flow.repository';
import { MailEventLedgerRepository } from '../persistence/mail-event-ledger.repository';

@Injectable()
export class PlaybookFlowMailTriggerOrchestrationService {
  constructor(
    private readonly flows: FlowRepository,
    private readonly ledger: MailEventLedgerRepository,
    private readonly ingestionService: PlaybookFlowMailEventIngestionService,
    private readonly matcherService: PlaybookFlowMailTriggerMatcherService,
  ) {}

  async ingestAndEvaluate(
    flowId: string,
    event: FlowNormalizedMailEventData,
  ): Promise<FlowMailTriggerEvaluationResultData> {
    const flow = await this.flows.findById(flowId);
    if (!flow) throw new NotFoundException('Flow not found');

    const ingestion = await this.ingestionService.ingest(flowId, event);

    if (ingestion.duplicate) {
      return {
        ingestion,
        match: { matched: ingestion.entry.status === 'matched', reasons: [] },
        finalStatus: ingestion.entry.status,
      };
    }

    const mailConfig = flow.triggerConfig?.params as FlowMailTriggerParamsData | undefined;
    const filters = this.extractFilters(mailConfig);

    const match = this.matcherService.match(filters, event);
    const finalStatus = match.matched ? 'matched' : 'ignored';

    await this.ledger.setStatus(ingestion.entry.id, finalStatus, match.matched ? null : match.reasons.join(','));

    return {
      ingestion: {
        ...ingestion,
        entry: { ...ingestion.entry, status: finalStatus, error: match.matched ? null : match.reasons.join(',') },
      },
      match,
      finalStatus,
    };
  }

  private extractFilters(config: FlowMailTriggerParamsData | undefined): FlowMailTriggerFiltersData {
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
