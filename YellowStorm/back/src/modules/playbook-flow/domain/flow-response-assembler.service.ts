import { Injectable, Logger } from '@nestjs/common';

import { IFlowResponse } from '../interfaces/playbook-flow.interface';
import type { FlowRecord } from '../persistence/flow.repository';
import { PlaybookFlowReplayReportService } from '../services/playbook-flow-replay-report.service';
import { PlaybookFlowReplayService } from '../services/playbook-flow-replay.service';

/** Fields the Mongo document left out of toJSON() when they were never set. */
const OMITTED_WHEN_NULL = [
  'assistantOperationId',
  'generationProvenance',
  'description',
  'triggerConfig',
  'designSettings',
  'advisorAutopilotTargetScore',
  'advisorAutopilotMaxTurns',
] as const;

/**
 * The JSON the Mongo flow document's toJSON() produced: `id` instead of `_id`, no `__v`, no key for a
 * field that was never set, `activeReplays` empty.
 */
export function toFlowJson(flow: FlowRecord): IFlowResponse {
  const json: Record<string, unknown> = { ...flow };
  for (const key of OMITTED_WHEN_NULL) {
    if (json[key] === null) delete json[key];
  }
  json.activeReplays = {};
  return json as unknown as IFlowResponse;
}

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

  toBaseFlowResponse(flow: FlowRecord): IFlowResponse {
    return toFlowJson(flow);
  }

  async toEnrichedFlowResponse(flowId: string, flow: FlowRecord): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const raw = this.toBaseFlowResponse(flow);
    const taskIds = (raw.nodes ?? []).map((node) => node.id);
    const activeReplays = await this.replayService.getActiveReplays(flowId, taskIds);

    raw.activeReplays = {};
    for (const replay of activeReplays) {
      raw.activeReplays[replay.taskId] = {
        id: String(replay.id),
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
      activeReplays.map((replay) => String(replay.id)),
    );
    for (const replay of activeReplays) {
      const entry = raw.activeReplays[replay.taskId];
      if (entry) {
        entry.latestOverallScore = scoreMap.get(String(replay.id)) ?? null;
      }
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_find_one_replay_enrichment_duration_ms flowId=${flowId} taskCount=${taskIds.length} durationMs=${durationMs}`);
    return raw;
  }
}
