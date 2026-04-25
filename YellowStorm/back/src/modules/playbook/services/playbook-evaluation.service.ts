import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { PlaybookExecution, PlaybookExecutionDocument } from '../schemas/playbook-execution.schema';
import {
  PlaybookEvaluationBaseline,
  PlaybookEvaluationBaselineDocument,
} from '../schemas/playbook-evaluation-baseline.schema';
import {
  PlaybookEvaluationExecution,
  PlaybookEvaluationExecutionDocument,
} from '../schemas/playbook-evaluation-execution.schema';
import type { PlaybookTaskData } from '../interfaces/playbook.interface';

interface SemanticEvaluationRequest {
  userId?: string;
  baselineOutput: string;
  currentOutput: string;
  taskTitle?: string;
  taskDescription?: string;
  baselineToolSummaries?: string[];
  currentToolSummaries?: string[];
}

interface SemanticEvaluationResult {
  matchScore: number;
  semanticSimilarityScore: number;
  evidenceConsistencyScore: number;
  judgeScore: number;
  reason: string;
  missingPoints: string[];
  changedPoints: string[];
  model: string;
  judgeUsed: boolean;
}

type EvaluationConfigInput = {
  expectation?: string;
  referenceBaselineId?: string | null;
  passThreshold?: number;
  warningThreshold?: number;
  weight?: number;
  rubricVersion?: string;
  weights?: {
    semanticMatch?: number;
    referenceMatch?: number;
    artifactRequirements?: number;
    formatCompliance?: number;
    evidenceConsistency?: number;
    executionHealth?: number;
  };
};

@Injectable()
export class PlaybookEvaluationService {
  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly playbookExecutionModel: Model<PlaybookExecutionDocument>,
    @InjectModel(PlaybookEvaluationBaseline.name)
    private readonly baselineModel: Model<PlaybookEvaluationBaselineDocument>,
    @InjectModel(PlaybookEvaluationExecution.name)
    private readonly evaluationExecutionModel: Model<PlaybookEvaluationExecutionDocument>,
    private readonly playbookGrpcService: PlaybookGrpcService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookEvaluationService');
  }

  isConfigured(): boolean {
    return this.playbookGrpcService.isAvailable;
  }

  async evaluateSemanticMatch(
    request: SemanticEvaluationRequest,
  ): Promise<SemanticEvaluationResult | null> {
    if (!request.baselineOutput?.trim() || !request.currentOutput?.trim()) {
      return null;
    }

    if (!this.isConfigured()) {
      this.logger.warn('Skipping semantic evaluation: ADK gRPC service is not available');
      return null;
    }

    const response = await this.playbookGrpcService.evaluateSemanticMatch({
      user_context: {
        user_id: request.userId || 'playbook-evaluation',
        username: request.userId || 'playbook-evaluation',
      },
      baseline_output: request.baselineOutput,
      current_output: request.currentOutput,
      task_title: request.taskTitle || '',
      task_description: request.taskDescription || '',
      baseline_tool_summaries: request.baselineToolSummaries || [],
      current_tool_summaries: request.currentToolSummaries || [],
    });

    if (!response?.has_match || !response.semantic_match) {
      return null;
    }

    const data = response.semantic_match as {
      match_score?: number;
      semantic_similarity_score?: number;
      evidence_consistency_score?: number;
      judge_score?: number;
      reason?: string;
      missing_points?: string[];
      changed_points?: string[];
      model?: string;
      judge_used?: boolean;
    };

    return {
      matchScore: Number(data.match_score ?? 0),
      semanticSimilarityScore: Number(data.semantic_similarity_score ?? 0),
      evidenceConsistencyScore: Number(data.evidence_consistency_score ?? data.semantic_similarity_score ?? 0),
      judgeScore: Number(data.judge_score ?? 0),
      reason: String(data.reason || ''),
      missingPoints: Array.isArray(data.missing_points) ? data.missing_points.map(String) : [],
      changedPoints: Array.isArray(data.changed_points) ? data.changed_points.map(String) : [],
      model: String(data.model || ''),
      judgeUsed: Boolean(data.judge_used),
    };
  }

  normalizeTaskEvaluationConfig(task: PlaybookTaskData | Record<string, any>) {
    const config = task?.evaluationConfig as EvaluationConfigInput | null | undefined;
    if (!config) {
      return null;
    }

    const expectation = String(config.expectation || '').trim();
    const referenceBaselineId = config.referenceBaselineId ? String(config.referenceBaselineId) : null;
    if (!expectation && !referenceBaselineId) {
      throw new BadRequestException('Evaluation task requires an expectation or a reference baseline');
    }

    const passThreshold = Number(config.passThreshold ?? 80);
    const warningThreshold = Number(config.warningThreshold ?? 60);
    const weight = Number(config.weight ?? 1);
    const weights = {
      semanticMatch: Number(config.weights?.semanticMatch ?? 40),
      referenceMatch: Number(config.weights?.referenceMatch ?? 20),
      artifactRequirements: Number(config.weights?.artifactRequirements ?? 20),
      formatCompliance: Number(config.weights?.formatCompliance ?? 10),
      evidenceConsistency: Number(config.weights?.evidenceConsistency ?? 5),
      executionHealth: Number(config.weights?.executionHealth ?? 5),
    };

    if (!Number.isFinite(passThreshold) || passThreshold < 0 || passThreshold > 100) {
      throw new BadRequestException('Evaluation pass threshold must be between 0 and 100');
    }
    if (!Number.isFinite(warningThreshold) || warningThreshold < 0 || warningThreshold > 100) {
      throw new BadRequestException('Evaluation warning threshold must be between 0 and 100');
    }
    if (warningThreshold > passThreshold) {
      throw new BadRequestException('Evaluation warning threshold cannot exceed pass threshold');
    }
    if (!Number.isFinite(weight) || weight < 0) {
      throw new BadRequestException('Evaluation weight must be a non-negative number');
    }
    for (const [name, value] of Object.entries(weights)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new BadRequestException(`Evaluation rubric weight '${name}' must be a non-negative number`);
      }
    }

    return {
      expectation,
      referenceBaselineId,
      passThreshold,
      warningThreshold,
      weight,
      rubricVersion: String(config.rubricVersion || 'evaluation-node-v1'),
      weights,
    };
  }

  async listEvaluationExecutions(playbookId: string, evaluationTaskId?: string) {
    const query: Record<string, unknown> = { playbookId: new Types.ObjectId(playbookId) };
    if (evaluationTaskId) {
      query.evaluationTaskId = evaluationTaskId;
    }
    return this.evaluationExecutionModel.find(query).sort({ createdAt: -1 }).lean().exec();
  }

  async getActiveBaseline(playbookId: string, evaluationTaskId: string) {
    return this.baselineModel.findOne({
      playbookId: new Types.ObjectId(playbookId),
      evaluationTaskId,
      replacedAt: null,
    }).sort({ createdAt: -1 }).lean().exec();
  }

  async persistEvaluationExecution(params: {
    playbookId: string;
    executionId: string;
    task: Record<string, any>;
    artifacts: Array<Record<string, any>>;
    durationMs?: number | null;
    completedAt?: Date;
    modelName?: string | null;
  }) {
    const config = this.normalizeTaskEvaluationConfig(params.task);
    if (!config) {
      return null;
    }
    const evaluationArtifact = (params.artifacts || []).find((artifact) =>
      artifact?.artifactKind === 'data'
      && artifact?.data
      && artifact.data.type === 'playbook_evaluation_result',
    );
    if (!evaluationArtifact?.data) {
      return null;
    }
    const payload = evaluationArtifact.data as Record<string, any>;
    const findings = Array.isArray(payload.findings) ? payload.findings : [];
    return this.evaluationExecutionModel.create({
      playbookId: new Types.ObjectId(params.playbookId),
      executionId: new Types.ObjectId(params.executionId),
      evaluationTaskId: String(params.task.id || ''),
      evaluationTaskTitle: String(params.task.title || ''),
      baselineId: config.referenceBaselineId ? new Types.ObjectId(config.referenceBaselineId) : null,
      mode: String(payload.mode || 'semantic'),
      status: 'completed',
      score: Number(payload.score ?? 0),
      verdict: String(payload.verdict || 'fail'),
      semanticScore: payload.semanticScore ?? null,
      referenceScore: payload.referenceScore ?? null,
      artifactScore: payload.artifactScore ?? null,
      formatScore: payload.formatScore ?? null,
      evidenceScore: payload.evidenceScore ?? null,
      executionHealthScore: payload.executionHealthScore ?? null,
      expectation: config.expectation,
      rubricVersion: config.rubricVersion,
      judgeModel: params.modelName ?? null,
      summary: String(payload.summary || ''),
      findings: findings.map((finding: any) => ({
        severity: String(finding.severity || 'info'),
        category: String(finding.category || 'semantic'),
        sourceTaskId: finding.sourceTaskId ? String(finding.sourceTaskId) : null,
        message: String(finding.message || ''),
      })),
      metrics: {
        connectedInputCount: Array.isArray((payload as any).connectedInputs) ? payload.connectedInputs.length : 0,
        artifactCount: params.artifacts.length,
        completedUpstreamSteps: 0,
        failedUpstreamSteps: 0,
        totalDurationMs: params.durationMs ?? null,
      },
      startedAt: params.completedAt || new Date(),
      completedAt: params.completedAt || new Date(),
      error: null,
    });
  }

  async replaceBaselineFromExecution(
    playbookId: string,
    evaluationTaskId: string,
    executionId: string,
    userId: string,
  ) {
    const execution = await this.playbookExecutionModel.findById(executionId).lean().exec();
    if (!execution || execution.playbookId?.toString() !== playbookId) {
      throw new BadRequestException('Execution not found for playbook baseline creation');
    }

    const snapshots = this.buildInputSnapshotsForEvaluationTask(execution, evaluationTaskId);

    await this.baselineModel.updateMany(
      {
        playbookId: new Types.ObjectId(playbookId),
        evaluationTaskId,
        replacedAt: null,
      },
      { $set: { replacedAt: new Date() } },
    );

    return this.baselineModel.create({
      playbookId: new Types.ObjectId(playbookId),
      evaluationTaskId,
      sourceExecutionId: new Types.ObjectId(executionId),
      sourceMode: 'selected_execution',
      inputSnapshots: snapshots,
      createdByUserId: new Types.ObjectId(userId),
      replacedAt: null,
    });
  }

  async replaceBaselineFromCurrentEvaluationExecution(
    playbookId: string,
    evaluationTaskId: string,
    executionId: string,
    evaluationExecutionId: string,
    userId: string,
  ) {
    const evaluationExecution = await this.evaluationExecutionModel.findById(evaluationExecutionId).lean().exec();
    if (!evaluationExecution || evaluationExecution.playbookId?.toString() !== playbookId) {
      throw new BadRequestException('Evaluation execution not found for playbook baseline creation');
    }
    if (evaluationExecution.executionId?.toString() !== executionId || evaluationExecution.evaluationTaskId !== evaluationTaskId) {
      throw new BadRequestException('Evaluation execution does not match the provided task or execution');
    }

    const execution = await this.playbookExecutionModel.findById(executionId).lean().exec();
    if (!execution || execution.playbookId?.toString() !== playbookId) {
      throw new BadRequestException('Execution not found for playbook baseline creation');
    }

    const snapshots = this.buildInputSnapshotsForEvaluationTask(execution, evaluationTaskId);

    await this.baselineModel.updateMany(
      {
        playbookId: new Types.ObjectId(playbookId),
        evaluationTaskId,
        replacedAt: null,
      },
      { $set: { replacedAt: new Date() } },
    );

    return this.baselineModel.create({
      playbookId: new Types.ObjectId(playbookId),
      evaluationTaskId,
      sourceExecutionId: new Types.ObjectId(executionId),
      sourceMode: 'current_inputs',
      inputSnapshots: snapshots,
      createdByUserId: new Types.ObjectId(userId),
      replacedAt: null,
    });
  }

  private buildInputSnapshotsForEvaluationTask(execution: any, evaluationTaskId: string) {
    const snapshot = execution.playbookSnapshot as { tasks?: Array<any>; edges?: Array<any> } | null;
    const tasks = Array.isArray(snapshot?.tasks) ? snapshot!.tasks : [];
    const edges = Array.isArray(snapshot?.edges) ? snapshot!.edges : [];
    const evaluationTask = tasks.find((task) => task.id === evaluationTaskId);
    if (!evaluationTask) {
      throw new BadRequestException('Evaluation task is not present in the execution snapshot');
    }

    const relevantEdges = edges.filter((edge) => edge.targetId === evaluationTaskId);
    if (!relevantEdges.length) {
      throw new BadRequestException('Evaluation task has no connected upstream inputs in the execution snapshot');
    }

    const taskResults = Array.isArray(execution.taskResults) ? (execution.taskResults as Array<any>) : [];
    const taskResultsById = new Map(taskResults.map((taskResult: any) => [taskResult.taskId, taskResult] as const));

    return relevantEdges.map((edge) => {
      const taskResult = taskResultsById.get(edge.sourceId) as any;
      if (!taskResult) {
        throw new BadRequestException(`Missing task result for upstream evaluation source '${edge.sourceId}'`);
      }
      const artifacts = Array.isArray(taskResult.artifacts) ? taskResult.artifacts : [];
      const matchedArtifacts = artifacts.filter((artifact: any) => {
        const artifactSourcePortId = artifact.sourcePortId ?? artifact.portId ?? null;
        return !edge.sourceOutputPortId || artifactSourcePortId === edge.sourceOutputPortId;
      });

      return {
        sourceTaskId: taskResult.taskId,
        sourceOutputPortId: edge.sourceOutputPortId ?? null,
        targetInputPortId: edge.targetInputPortId ?? null,
        output: taskResult.output ?? null,
        artifacts: matchedArtifacts.map((artifact: any) => ({
          id: artifact.id ?? null,
          kind: String(artifact.artifactKind || artifact.kind || 'text'),
          name: artifact.filename ?? artifact.name ?? null,
          mimeType: artifact.mimeType ?? null,
          uri: artifact.url ?? artifact.uri ?? null,
          textPreview: artifact.content ? String(artifact.content).slice(0, 2000) : null,
          metadata: artifact.metadata ?? null,
        })),
      };
    });
  }
}
