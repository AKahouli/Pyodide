import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';
import {
  FlowValidatedReplay,
  FlowValidatedReplayDocument,
  FlowReplayValidationStatus,
} from '../schemas/playbook-flow-validated-replay.schema';
import {
  FlowEvaluationExecution,
  FlowEvaluationExecutionDocument,
} from '../schemas/playbook-flow-evaluation-execution.schema';

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
  generatedAt: string;
  iterations: FlowRepeatabilityIterationSummary[];
}

const MIN_ITERATIONS = 2;
const PASS_SCORE_THRESHOLD = 80;

@Injectable()
export class PlaybookFlowRepeatabilityService {
  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name) private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowValidatedReplay.name) private readonly replayModel: Model<FlowValidatedReplayDocument>,
    @InjectModel(FlowEvaluationExecution.name) private readonly evalModel: Model<FlowEvaluationExecutionDocument>,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowRepeatabilityService'); }

  async getRepeatability(
    flowId: string,
    limit = 5,
    offset = 0,
  ): Promise<FlowRepeatabilitySummary> {
    const flow = await this.flowModel.findById(flowId).lean().exec();
    if (!flow) return this.emptySummary(flowId);

    const stepNodes = this.extractStepNodes(flow);
    if (stepNodes.length === 0) return this.emptySummary(flowId);

    const baseQuery = { flowId, status: 'completed' };
    const totalCount = await this.executionModel.countDocuments(baseQuery);

    if (totalCount < MIN_ITERATIONS) {
      return {
        flowId,
        totalIterations: totalCount,
        evaluatedIterations: 0,
        passedIterations: 0,
        overallAverageMatchScore: null,
        overallAverageContentScore: null,
        generatedAt: new Date().toISOString(),
        iterations: [],
      };
    }

    const taskIds = stepNodes.map((n) => n.id);
    const goldenBaselines = await this.loadGoldenBaselines(flowId, taskIds);
    const allExecutions = await this.executionModel
      .find(baseQuery)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const allIterations = await Promise.all(
      allExecutions.map((exec) =>
        this.evaluateIteration(exec._id.toString(), stepNodes, goldenBaselines),
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

    return {
      flowId,
      totalIterations: allIterations.length,
      evaluatedIterations: evaluatedIterations.length,
      passedIterations: passedIterations.length,
      overallAverageMatchScore,
      overallAverageContentScore,
      generatedAt: new Date().toISOString(),
      iterations: allIterations.slice(offset, offset + limit),
    };
  }

  async getTaskRepeatability(
    flowId: string,
    taskId: string,
    limit = 5,
  ): Promise<FlowRepeatabilityTaskSummary[] | null> {
    const flow = await this.flowModel.findById(flowId).lean().exec();
    if (!flow) return null;

    const node = flow.nodes.find((n) => n.id === taskId && n.kind === 'step');
    if (!node) return null;

    const goldenBaselines = await this.loadGoldenBaselines(flowId, [taskId]);

    const executions = await this.executionModel
      .find({ flowId, status: 'completed' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return Promise.all(
      executions.map((exec) =>
        this.evaluateTaskExecution(exec._id.toString(), node, goldenBaselines),
      ),
    );
  }

  resolveExpectedResult(
    node: { metadata?: Record<string, unknown> },
    goldenBaseline: string | null,
  ): { value: string | null; source: FlowExpectedResultSource } {
    const nodeValue = String(node.metadata?.['expectedResult'] || '').trim();
    if (nodeValue) return { value: nodeValue, source: 'node_metadata' };
    if (goldenBaseline) return { value: goldenBaseline, source: 'golden_baseline' };
    return { value: null, source: 'none' };
  }

  private async evaluateIteration(
    executionId: string,
    nodes: Array<{ id: string; label?: string; metadata?: Record<string, unknown> }>,
    goldenBaselines: Map<string, string>,
  ): Promise<FlowRepeatabilityIterationSummary> {
    const taskSummaries = await Promise.all(
      nodes.map((node) =>
        this.evaluateTaskExecution(executionId, node, goldenBaselines),
      ),
    );

    const execution = await this.executionModel.findById(executionId).lean();

    const evaluatedTasks = taskSummaries.filter((t) => t.evaluated);
    const passedTasks = taskSummaries.filter((t) => t.passed);

    return {
      executionId,
      completedAt: execution?.endedAt ?? null,
      taskCount: taskSummaries.length,
      evaluatedTasks: evaluatedTasks.length,
      passedTasks: passedTasks.length,
      averageMatchScore: this.computeOverallAverage(evaluatedTasks.map((t) => t.matchScore)),
      averageContentScore: this.computeOverallAverage(evaluatedTasks.map((t) => t.contentScore)),
      passed: evaluatedTasks.length > 0 && passedTasks.length === evaluatedTasks.length,
      tasks: taskSummaries,
    };
  }

  private async evaluateTaskExecution(
    executionId: string,
    node: { id: string; label?: string; metadata?: Record<string, unknown> },
    goldenBaselines: Map<string, string>,
  ): Promise<FlowRepeatabilityTaskSummary> {
    const baseline = goldenBaselines.get(node.id) || null;
    const { value: expectedResult, source: expectedResultSource } =
      this.resolveExpectedResult(node, baseline);

    const taskResult = await this.taskResultModel
      .findOne({ executionId, taskId: node.id, status: 'completed' })
      .lean();

    const output = taskResult
      ? typeof taskResult.output === 'string' ? taskResult.output : JSON.stringify(taskResult.output ?? '')
      : null;

    const completedAt = taskResult?.endedAt ?? null;

    const structuralEvaluated = expectedResultSource !== 'none' && output !== null;
    const matchScore = structuralEvaluated && expectedResult && output
      ? this.computeTextSimilarity(expectedResult, output)
      : null;
    const structuralPassed = matchScore !== null && matchScore >= PASS_SCORE_THRESHOLD;

    const contentEval = await this.evalModel
      .findOne({ executionId, taskId: node.id })
      .sort({ createdAt: -1 })
      .lean();

    const contentScore = contentEval
      ? this.normalizePercentScore(contentEval.semanticScore)
      : null;
    const contentEvaluated = contentScore !== null;

    const evaluated = structuralEvaluated || contentEvaluated;
    const passed = evaluated && structuralPassed &&
      (!contentEvaluated || (contentScore !== null && contentScore >= PASS_SCORE_THRESHOLD));

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
      contentScore,
      contentEvaluated,
      passed,
      evaluated,
    };
  }

  private extractStepNodes(flow: any): Array<{
    id: string;
    label?: string;
    metadata?: Record<string, unknown>;
  }> {
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
  ): Promise<Map<string, string>> {
    const baselines = new Map<string, string>();
    if (taskIds.length === 0) return baselines;

    const replays = await this.replayModel
      .find({
        flowId,
        taskId: { $in: taskIds },
        status: FlowReplayValidationStatus.ACTIVE,
      })
      .lean()
      .exec();

    for (const replay of replays) {
      if (replay.referenceOutput) {
        baselines.set(replay.taskId, replay.referenceOutput);
      }
    }
    return baselines;
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

  private computeOverallAverage(scores: Array<number | null>): number | null {
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
      generatedAt: new Date().toISOString(),
      iterations: [],
    };
  }
}
