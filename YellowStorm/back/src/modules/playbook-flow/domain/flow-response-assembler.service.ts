import { Injectable, Logger } from '@nestjs/common';

import { IFlowResponse } from '../interfaces/playbook-flow.interface';
import { FlowDocument } from '../schemas/playbook-flow.schema';
import { PlaybookFlowReplayReportService } from '../services/playbook-flow-replay-report.service';
import { PlaybookFlowReplayService } from '../services/playbook-flow-replay.service';

@Injectable()
/**
 * Builds public playbook flow responses, keeping base reads replay-free and
 * adding replay metadata only for enriched views.
 */
export class FlowResponseAssemblerService {
  private readonly logger = new Logger(FlowResponseAssemblerService.name);

  constructor(
    private readonly replayService: PlaybookFlowReplayService,
    private readonly replayReportService: PlaybookFlowReplayReportService,
  ) {}

  toBaseFlowResponse(flow: FlowDocument): IFlowResponse {
    const raw = flow.toJSON() as unknown as IFlowResponse;
    raw.definitionRevision = raw.definitionRevision ?? 0;
    raw.activeReplays = {};
    return raw;
  }

  async toEnrichedFlowResponse(flowId: string, flow: FlowDocument): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const raw = this.toBaseFlowResponse(flow);
    const taskIds = (raw.nodes ?? []).map((node) => node.id);
    const activeReplays = await this.replayService.getActiveReplays(flowId, taskIds);

    raw.activeReplays = {};
    for (const replay of activeReplays) {
      raw.activeReplays[replay.taskId] = {
        id: String(replay._id),
        validationVersion: replay.validationVersion,
        isStale: replay.isStale ?? false,
        staleReasons: replay.staleReasons ?? [],
        preserveOutputFormat: replay.preserveOutputFormat ?? false,
        outputFormatGuide: replay.outputFormatGuide ?? null,
        formatGuideStatus: replay.formatGuideStatus ?? null,
        label: replay.label ?? null,
        latestOverallScore: null,
      };
    }

    const scoreMap = await this.replayReportService.findLatestScoresForReplays(
      activeReplays.map((replay) => String(replay._id)),
    );
    for (const replay of activeReplays) {
      const entry = raw.activeReplays[replay.taskId];
      if (entry) {
        entry.latestOverallScore = scoreMap.get(String(replay._id)) ?? null;
      }
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_find_one_replay_enrichment_duration_ms flowId=${flowId} taskCount=${taskIds.length} durationMs=${durationMs}`);
    return raw;
  }
}
