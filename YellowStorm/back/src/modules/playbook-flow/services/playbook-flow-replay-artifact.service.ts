import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FlowValidatedReplay,
  FlowValidatedReplayDocument,
  FlowReplayValidationStatus,
} from '../schemas/playbook-flow-validated-replay.schema';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';
import { LoggerService } from '@modules/logger';

@Injectable()
export class PlaybookFlowReplayArtifactService {
  constructor(
    @InjectModel(FlowValidatedReplay.name)
    private readonly replayModel: Model<FlowValidatedReplayDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookFlowReplayArtifactService');
  }

  async resolveReplayArtifacts(
    flowId: string,
    taskIds: string[],
  ): Promise<Map<string, ResolvedReplayArtifacts>> {
    const result = new Map<string, ResolvedReplayArtifacts>();
    if (!taskIds.length) return result;

    const activeReplays = await this.replayModel.find({
      flowId,
      taskId: { $in: taskIds },
      status: FlowReplayValidationStatus.ACTIVE,
    }).lean().exec();

    for (const replay of activeReplays) {
      const resolved = this.mapReplayToResolvedArtifacts(replay);
      result.set(replay.taskId, resolved);
    }

    return result;
  }

  private mapReplayToResolvedArtifacts(replay: Record<string, any>): ResolvedReplayArtifacts {
    return {
      taskId: replay.taskId,
      replayId: String(replay._id),
      validationVersion: replay.validationVersion,
      referenceOutput: replay.referenceOutput ?? null,
      outputFormatGuide: replay.outputFormatGuide ?? null,
      toolCalls: replay.toolCalls ?? [],
      reasoningChain: replay.reasoningChain ?? [],
      replayConfig: {
        replayOutputFormat: replay.replayConfig?.replayOutputFormat ?? false,
        replayToolTrace: replay.replayConfig?.replayToolTrace ?? false,
        replayReasoningChain: replay.replayConfig?.replayReasoningChain ?? false,
      },
    };
  }
}
