import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { FlowRepository } from '../persistence/flow.repository';
import { ExecutionRepository } from '../persistence/execution.repository';
import { TaskResultRepository } from '../persistence/task-result.repository';
import { ValidatedReplayRepository } from '../persistence/validated-replay.repository';
import { EvaluationExecutionRepository } from '../persistence/evaluation-execution.repository';
import {
  type FlowReplayOutputContract,
  type FlowReplayToolPolicy,
  normalizeReplayMode,
  type ReplayMode,
} from '../interfaces/playbook-flow-validated-replay.interface';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { scoreToolPolicyCompliance } from '../utils/playbook-flow-tool-policy.util';

export type FlowExpectedResultSource = 'node_metadata' | 'golden_baseline' | 'none';
export type FlowRepeatabilityMatchState = 'matched' | 'not_matched' | 'not_evaluated';

export interface FlowRepeatabilityTaskSummary {
  taskId: string;
  taskLabel: string;
  output: string | null;
  completedAt: Date | null;
  expectedResult: string | null;
  expectedResultSource: FlowExpectedResultSource;
  matchScore: number | null;
  matchState: FlowRepeatabilityMatchState;
  structuralPassed: boolean;
  structuralEvaluated: boolean;
  structuralScore: number | null;
  structuralDriftReasons: string[];
  toolPolicyScore: number | null;
  textMatchScore: number | null;
  contentScore: number | null;
  contentEvaluated: boolean;
  passed: boolean;
  evaluated: boolean;
}

export interface FlowRepeatabilityIterationSummary {
  executionId: string;
  completedAt: Date | null;
  taskCount: number;
  evaluatedTasks: number;
  passedTasks: number;
  averageMatchScore: number | null;
  averageContentScore: number | null;
  averageToolPolicyScore: number | null;
  passed: boolean;
  tasks: FlowRepeatabilityTaskSummary[];
}

export interface FlowRepeatabilitySummary {
  flowId: string;
  totalIterations: number;
  evaluatedIterations: number;
  passedIterations: number;
  overallAverageMatchScore: number | null;
  overallAverageContentScore: number | null;
  overallAverageToolPolicyScore: number | null;
  generatedAt: string;
  iterations: FlowRepeatabilityIterationSummary[];
}

const MIN_ITERATIONS = 2;
const PASS_SCORE_THRESHOLD = 80;
const STRUCTURAL_WEIGHT = 0.5;
const TEXT_WEIGHT = 0.1;
const CONTENT_WEIGHT = 0.4;

interface GoldenBaselineRecord {
  flowId?: string;
  replayId?: string;
  mode: ReplayMode | null;
  referenceOutput: string | null;
  toolPolicy: FlowReplayToolPolicy | null;
  outputContract: FlowReplayOutputContract | null;
}

@Injectable()
export class PlaybookFlowRepeatabilityService {
  constructor(
    private readonly flowRepository: FlowRepository,
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
    private readonly replayRepository: ValidatedReplayRepository,
    private readonly evaluationExecutionRepository: EvaluationExecutionRepository,
    private readonly logger: LoggerService,
    private readonly outputContractService: PlaybookFlowOutputContractService,
  ) { this.logger.setContext('PlaybookFlowRepeatabilityService'); }

  async getRepeatability(
    flowId: string,
    limit = 5,
    offset = 0,
  ): Promise<FlowRepeatabilitySummary> {
    const flow = await this.flowRepository.findById(flowId);
    if (!flow) return this.emptySummary(flowId);

    const stepNodes = this.extractStepNodes(flow);
    if (stepNodes.length === 0) return this.emptySummary(flowId);

    const totalCount = await this.executionRepository.countByFlow(flowId, ['completed']);

    if (totalCount < MIN_ITERATIONS) {
      return {
        flowId,
        totalIterations: totalCount,
        evaluatedIterations: 0,
        passedIterations: 0,
        overallAverageMatchScore: null,
        overallAverageContentScore: null,
        overallAverageToolPolicyScore: null,
        generatedAt: new Date().toISOString(),
        iterations: [],
      };
    }

    const taskIds = stepNodes.map((n) => n.id);
    const goldenBaselines = await this.loadGoldenBaselines(flowId, taskIds);
    const allExecutions = await this.executionRepository.listByFlow(flowId, { statuses: ['completed'] });

    const allIterations = await Promise.all(
      allExecutions.map((exec) =>
        this.evaluateIteration(exec, stepNodes, goldenBaselines),
      ),
    );

    const evaluatedIterations = allIterations.filter((i) => i.evaluatedTasks > 0);
    const passedIterations = evaluatedIterations.filter((i) => i.passed);

    const overallAverageMatchScore = this.computeOverallAverage(
      evaluatedIterations.map((i) => i.averageMatchScore),
    );
    const overallAverageContentScore = this.computeOverallAverage(
      evaluatedIterations.map((i) => i.averageContentScore),
    );
    const overallAverageToolPolicyScore = this.computeOverallAverage(
      evaluatedIterations.map((i) => i.averageToolPolicyScore),
    );

    return {
      flowId,
      totalIterations: allIterations.length,
      evaluatedIterations: evaluatedIterations.length,
      passedIterations: passedIterations.length,
      overallAverageMatchScore,
      overallAverageContentScore,
      overallAverageToolPolicyScore,
      generatedAt: new Date().toISOString(),
      iterations: allIterations.slice(offset, offset + limit),
    };
  }

  async getTaskRepeatability(
    flowId: string,
    taskId: string,
    limit = 5,
  ): Promise<FlowRepeatabilityTaskSummary[] | null> {
    const flow = await this.flowRepository.findById(flowId);
    if (!flow) return null;

    const node = flow.nodes.find((n) => n.id === taskId && n.kind === 'step');
    if (!node) return null;

    const goldenBaselines = await this.loadGoldenBaselines(flowId, [taskId]);

    const executions = await this.executionRepository.listByFlow(flowId, { statuses: ['completed'], limit });

    return Promise.all(
      executions.map((exec) =>
        this.evaluateTaskExecution(exec.id, node, goldenBaselines),
      ),
    );
  }

  resolveExpectedResult(
    node: { metadata?: Record<string, unknown> },
    goldenBaseline: GoldenBaselineRecord | null,
  ): { value: string | null; source: FlowExpectedResultSource } {
    const nodeValue = String(node.metadata?.expectedResult || '').trim();
    if (nodeValue) return { value: nodeValue, source: 'node_metadata' };
    if (goldenBaseline?.referenceOutput) return { value: goldenBaseline.referenceOutput, source: 'golden_baseline' };
    return { value: null, source: 'none' };
  }

  private async evaluateIteration(
    execution: { id: string; endedAt: Date | null },
    nodes: { id: string; label?: string; metadata?: Record<string, unknown> }[],
    goldenBaselines: Map<string, GoldenBaselineRecord>,
  ): Promise<FlowRepeatabilityIterationSummary> {
    const taskSummaries = await Promise.all(
      nodes.map((node) =>
        this.evaluateTaskExecution(execution.id, node, goldenBaselines),
      ),
    );

    const evaluatedTasks = taskSummaries.filter((t) => t.evaluated);
    const passedTasks = taskSummaries.filter((t) => t.passed);

    return {
      executionId: execution.id,
      completedAt: execution.endedAt ?? null,
      taskCount: taskSummaries.length,
      evaluatedTasks: evaluatedTasks.length,
      passedTasks: passedTasks.length,
      averageMatchScore: this.computeOverallAverage(evaluatedTasks.map((t) => t.matchScore)),
      averageContentScore: this.computeOverallAverage(evaluatedTasks.map((t) => t.contentScore)),
      averageToolPolicyScore: this.computeOverallAverage(evaluatedTasks.map((t) => t.toolPolicyScore)),
      passed: evaluatedTasks.length > 0 && passedTasks.length === evaluatedTasks.length,
      tasks: taskSummaries,
    };
  }

  private async evaluateTaskExecution(
    executionId: string,
    node: { id: string; label?: string; metadata?: Record<string, unknown> },
    goldenBaselines: Map<string, GoldenBaselineRecord>,
  ): Promise<FlowRepeatabilityTaskSummary> {
    const baseline = goldenBaselines.get(node.id) || null;
    const { value: expectedResult, source: expectedResultSource } =
      this.resolveExpectedResult(node, baseline);

    // The task's first completed iteration, as Mongo's unsorted findOne returned it.
    const [taskResult] = await this.taskResultRepository.listForExecution(executionId, {
      taskIds: [node.id],
      statuses: ['completed'],
      light: true,
      with: ['output', 'toolTrace'],
    });

    const output = taskResult
      ? typeof taskResult.output === 'string' ? taskResult.output : JSON.stringify(taskResult.output ?? '')
      : null;

    const completedAt = taskResult?.endedAt ?? null;
    const toolPolicy = scoreToolPolicyCompliance({
      toolPolicy: baseline?.toolPolicy ?? null,
      toolTrace: (taskResult?.toolTrace ?? []) as unknown as Parameters<typeof scoreToolPolicyCompliance>[0]['toolTrace'],
    });

    const textMatchScore = expectedResultSource !== 'none' && expectedResult && output
      ? this.computeTextSimilarity(expectedResult, output)
      : null;
    const structuralValidation = this.outputContractService.validateOutputContract({
      output,
      outputContract: baseline?.outputContract ?? null,
    });
    const structuralEvaluated = structuralValidation.evaluated || (expectedResultSource !== 'none' && output !== null);
    const structuralScore = structuralValidation.score;
    const structuralPassed = structuralValidation.evaluated
      ? structuralValidation.passed
      : textMatchScore !== null && textMatchScore >= PASS_SCORE_THRESHOLD;
    const structuralDriftReasons = structuralValidation.evaluated
      ? structuralValidation.reasons
      : [];

    const contentEval = await this.evaluationExecutionRepository.findLatestForTask(executionId, node.id);

    const contentScore = contentEval
      ? this.normalizePercentScore(contentEval.semanticScore)
      : null;
    const contentEvaluated = contentScore !== null;

    const matchScore = this.computeWeightedScore({
      structuralScore,
      textMatchScore,
      contentScore,
    });

    const hasStrictToolPolicyViolation = baseline?.mode === 'replay_strict' && toolPolicy.evaluated && !toolPolicy.passed;

    const evaluated = structuralEvaluated || contentEvaluated;
    const passed = evaluated && structuralPassed &&
      matchScore !== null && matchScore >= PASS_SCORE_THRESHOLD &&
      (!contentEvaluated || (contentScore !== null && contentScore >= PASS_SCORE_THRESHOLD)) &&
      !hasStrictToolPolicyViolation;

    let matchState: FlowRepeatabilityMatchState;
    if (!evaluated) matchState = 'not_evaluated';
    else if (structuralPassed) matchState = 'matched';
    else matchState = 'not_matched';

    return {
      taskId: node.id,
      taskLabel: node.label ?? node.id,
      output,
      completedAt,
      expectedResult,
      expectedResultSource,
      matchScore,
      matchState,
      structuralPassed,
      structuralEvaluated,
      structuralScore,
      structuralDriftReasons,
      toolPolicyScore: toolPolicy.score,
      textMatchScore,
      contentScore,
      contentEvaluated,
      passed,
      evaluated,
    };
  }

  private extractStepNodes(flow: any): {
    id: string;
    label?: string;
    metadata?: Record<string, unknown>;
  }[] {
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    return nodes
      .filter((n: any) => n.kind === 'step')
      .map((n: any) => ({
        id: n.id || '',
        label: n.label || '',
        metadata: n.metadata ?? {},
      }));
  }

  private async loadGoldenBaselines(
    flowId: string,
    taskIds: string[],
  ): Promise<Map<string, GoldenBaselineRecord>> {
    const baselines = new Map<string, GoldenBaselineRecord>();
    if (taskIds.length === 0) return baselines;

    const replays = await this.replayRepository.listActiveForTasks(flowId, taskIds);

    for (const replay of replays) {
      baselines.set(replay.taskId, {
        flowId: replay.flowId,
        replayId: replay.id,
        mode: replay.mode ? normalizeReplayMode(replay.mode) : null,
        referenceOutput: replay.referenceOutput ?? null,
        toolPolicy: replay.toolPolicy ?? null,
        outputContract: replay.outputContract ?? null,
      });
    }
    return baselines;
  }

  private computeWeightedScore(params: {
    structuralScore: number | null;
    textMatchScore: number | null;
    contentScore: number | null;
  }): number | null {
    const weightedParts = [
      params.structuralScore !== null ? { score: params.structuralScore, weight: STRUCTURAL_WEIGHT } : null,
      params.textMatchScore !== null ? { score: params.textMatchScore, weight: TEXT_WEIGHT } : null,
      params.contentScore !== null ? { score: params.contentScore, weight: CONTENT_WEIGHT } : null,
    ].filter((entry): entry is { score: number; weight: number } => entry !== null);

    if (weightedParts.length === 0) {
      return null;
    }

    const totalWeight = weightedParts.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight === 0) {
      return null;
    }

    const weightedScore = weightedParts.reduce((sum, entry) => sum + (entry.score * entry.weight), 0) / totalWeight;
    return Math.round(weightedScore * 10) / 10;
  }

  private computeTextSimilarity(expected: string, actual: string): number {
    const a = expected.toLowerCase().trim();
    const b = actual.toLowerCase().trim();
    if (!a || !b) return 0;
    if (a === b) return 100;

    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));

    let intersection = 0;
    for (const word of setA) {
      if (setB.has(word)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    if (union === 0) return 0;

    const jaccard = intersection / union;
    const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return Math.round((jaccard * 0.6 + lenRatio * 0.4) * 100 * 10) / 10;
  }

  private normalizePercentScore(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return null;
    const normalized = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
    return Math.max(0, Math.min(100, normalized));
  }

  private computeOverallAverage(scores: (number | null)[]): number | null {
    const valid = scores.filter((s): s is number => s !== null);
    if (valid.length === 0) return null;
    return Math.round((valid.reduce((sum, s) => sum + s, 0) / valid.length) * 10) / 10;
  }

  private emptySummary(flowId: string): FlowRepeatabilitySummary {
    return {
      flowId,
      totalIterations: 0,
      evaluatedIterations: 0,
      passedIterations: 0,
      overallAverageMatchScore: null,
      overallAverageContentScore: null,
      overallAverageToolPolicyScore: null,
      generatedAt: new Date().toISOString(),
      iterations: [],
    };
  }
}
