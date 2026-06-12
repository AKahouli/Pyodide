import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FlowValidatedReplay,
  FlowValidatedReplayDocument,
  FlowReplayValidationStatus,
  type FlowReplayFingerprints,
  normalizeReplayMode,
} from '../schemas/playbook-flow-validated-replay.schema';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowReplayHashService } from './playbook-flow-replay-hash.service';

@Injectable()
export class PlaybookFlowReplayArtifactService {
  constructor(
    @InjectModel(FlowValidatedReplay.name)
    private readonly replayModel: Model<FlowValidatedReplayDocument>,
    private readonly logger: LoggerService,
    private readonly replayHashService: PlaybookFlowReplayHashService,
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

  async resolveReplayArtifactByIdentity(params: {
    flowId: string;
    taskId: string;
    replayId: string;
    validationVersion: number;
  }): Promise<ResolvedReplayArtifacts | null> {
    const replay = await this.replayModel.findOne({
      _id: params.replayId,
      flowId: params.flowId,
      taskId: params.taskId,
      validationVersion: params.validationVersion,
    }).lean().exec();

    if (!replay) {
      return null;
    }

    return this.mapReplayToResolvedArtifacts(replay);
  }

  private mapReplayToResolvedArtifacts(replay: Record<string, any>): ResolvedReplayArtifacts {
    return {
      taskId: replay.taskId,
      replayId: String(replay._id),
      referenceExecutionId: replay.referenceExecutionId,
      validationVersion: replay.validationVersion,
      mode: normalizeReplayMode(replay.mode),
      flowId: replay.flowId,
      isStale: replay.isStale ?? false,
      staleReasons: replay.staleReasons ?? [],
      referenceOutput: replay.referenceOutput ?? null,
      outputFormatGuide: replay.outputFormatGuide ?? null,
      intentKey: replay.intentKey ?? null,
      intentLabel: replay.intentLabel ?? null,
      reasoningOutline: replay.reasoningOutline ?? [],
      stableReasoningRules: replay.stableReasoningRules ?? [],
      contextVariableSchema: replay.contextVariableSchema ?? [],
      toolTraceTemplate: replay.toolTraceTemplate ?? [],
      semanticChecklist: replay.semanticChecklist ?? [],
      hitlMemorySnapshots: replay.hitlMemorySnapshots ?? [],
      driftPolicy: replay.driftPolicy ?? null,
      toolCalls: replay.toolCalls ?? [],
      reasoningChain: replay.reasoningChain ?? [],
      fingerprints: this.normalizeFingerprints(replay),
      behaviorBaseline: replay.behaviorBaseline ?? null,
      toolPolicy: replay.toolPolicy ?? null,
      outputContract: replay.outputContract ?? null,
      replayConfig: {
        replayOutputFormat: replay.replayConfig?.replayOutputFormat ?? false,
        replayToolTrace: replay.replayConfig?.replayToolTrace ?? false,
        replayReasoningChain: replay.replayConfig?.replayReasoningChain ?? true,
      },
    };
  }

  private normalizeFingerprints(replay: Record<string, any>): FlowReplayFingerprints | null {
    const fingerprints = replay.fingerprints ?? null;
    if (!fingerprints) {
      return null;
    }

    return {
      ...fingerprints,
      nodeSnapshotHash: fingerprints.nodeSnapshotHash ?? null,
    };
  }
}
