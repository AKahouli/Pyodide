import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
  StepStatus,
} from '../schemas/playbook-execution.schema';
import {
  PlaybookValidatedReplay,
  PlaybookValidatedReplayDocument,
  ReplayValidationStatus,
} from '../schemas/playbook-validated-replay.schema';
import { LoggerService } from '../../logger';

export type ExpectedResultSource = 'node_field' | 'golden_baseline' | 'none';

export interface TaskRepeatabilityResult {
  taskId: string;
  taskTitle: string;
  expectedResult: string | null;
  expectedResultSource: ExpectedResultSource;
  executionCount: number;
  comparableCount: number;
  repeatabilityScore: number | null;
  verdict: 'stable' | 'unstable' | 'insufficient_data' | 'no_baseline';
  findings: string[];
  perExecution: Array<{
    executionId: string;
    executionNumber: number;
    output: string | null;
    score: number | null;
    completedAt: Date | null;
  }>;
}

export interface PlaybookRepeatabilitySummary {
  playbookId: string;
  overallScore: number | null;
  overallVerdict: 'stable' | 'unstable' | 'insufficient_data' | 'no_baseline';
  totalTasks: number;
  evaluatedTasks: number;
  tasks: TaskRepeatabilityResult[];
  generatedAt: string;
}

const MIN_COMPARABLE_EXECUTIONS = 2;
const STABLE_THRESHOLD = 75;
const UNSTABLE_THRESHOLD = 50;

@Injectable()
export class PlaybookRepeatabilityService {
  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    @InjectModel(PlaybookValidatedReplay.name)
    private readonly replayModel: Model<PlaybookValidatedReplayDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookRepeatabilityService');
  }

  async getRepeatability(
    playbookId: string,
    limit = 5,
  ): Promise<PlaybookRepeatabilitySummary> {
    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    if (!playbook) {
      return this.emptySummary(playbookId);
    }

    const tasks = this.extractTasksFromSnapshot(playbook);
    if (tasks.length === 0) {
      return this.emptySummary(playbookId);
    }

    const executions = await this.executionModel
      .find({
        playbookId: new Types.ObjectId(playbookId),
        status: StepStatus.COMPLETED,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    if (executions.length < MIN_COMPARABLE_EXECUTIONS) {
      return {
        playbookId,
        overallScore: null,
        overallVerdict: 'insufficient_data',
        totalTasks: tasks.length,
        evaluatedTasks: 0,
        tasks: tasks.map((t) => ({
          taskId: t.id,
          taskTitle: t.title || '',
          expectedResult: null,
          expectedResultSource: 'none' as ExpectedResultSource,
          executionCount: executions.length,
          comparableCount: 0,
          repeatabilityScore: null,
          verdict: 'insufficient_data' as const,
          findings: [
            `Need at least ${MIN_COMPARABLE_EXECUTIONS} completed executions (found ${executions.length})`,
          ],
          perExecution: [],
        })),
        generatedAt: new Date().toISOString(),
      };
    }

    const goldenBaselines = await this.loadGoldenBaselines(
      playbookId,
      tasks.map((t) => t.id),
    );

    const taskResults = tasks.map((task) =>
      this.evaluateTaskRepeatability(task, executions, goldenBaselines),
    );

    const evaluatedTasks = taskResults.filter(
      (r) => r.verdict !== 'insufficient_data' && r.verdict !== 'no_baseline',
    );
    const overallScore = this.computeOverallScore(evaluatedTasks);

    return {
      playbookId,
      overallScore,
      overallVerdict: this.scoreToVerdict(overallScore, evaluatedTasks.length > 0),
      totalTasks: tasks.length,
      evaluatedTasks: evaluatedTasks.length,
      tasks: taskResults,
      generatedAt: new Date().toISOString(),
    };
  }

  async getTaskRepeatability(
    playbookId: string,
    taskId: string,
    limit = 5,
  ): Promise<TaskRepeatabilityResult | null> {
    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    if (!playbook) {
      return null;
    }

    const tasks = this.extractTasksFromSnapshot(playbook);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      return null;
    }

    const executions = await this.executionModel
      .find({
        playbookId: new Types.ObjectId(playbookId),
        status: StepStatus.COMPLETED,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    const goldenBaselines = await this.loadGoldenBaselines(playbookId, [taskId]);
    return this.evaluateTaskRepeatability(task, executions, goldenBaselines);
  }

  resolveExpectedResult(
    task: { expectedResult?: string | null },
    goldenBaseline: string | null,
  ): { value: string | null; source: ExpectedResultSource } {
    const nodeValue = (task.expectedResult || '').trim();
    if (nodeValue) {
      return { value: nodeValue, source: 'node_field' };
    }
    if (goldenBaseline) {
      return { value: goldenBaseline, source: 'golden_baseline' };
    }
    return { value: null, source: 'none' };
  }

  private extractTasksFromSnapshot(playbook: any): Array<{
    id: string;
    title: string;
    expectedResult?: string | null;
  }> {
    const tasks = Array.isArray(playbook.tasks) ? playbook.tasks : [];
    return tasks
      .filter((t: any) => t.taskType !== 'evaluation')
      .map((t: any) => ({
        id: t.id || '',
        title: t.title || '',
        expectedResult: t.expectedResult ?? null,
      }));
  }

  private async loadGoldenBaselines(
    playbookId: string,
    taskIds: string[],
  ): Promise<Map<string, string>> {
    const baselines = new Map<string, string>();
    if (taskIds.length === 0) {
      return baselines;
    }

    const replays = await this.replayModel
      .find({
        playbookId: new Types.ObjectId(playbookId),
        taskId: { $in: taskIds },
        status: ReplayValidationStatus.ACTIVE,
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

  private evaluateTaskRepeatability(
    task: { id: string; title: string; expectedResult?: string | null },
    executions: any[],
    goldenBaselines: Map<string, string>,
  ): TaskRepeatabilityResult {
    const baseline = goldenBaselines.get(task.id) || null;
    const { value: expectedResult, source } = this.resolveExpectedResult(
      task,
      baseline,
    );

    if (source === 'none') {
      return {
        taskId: task.id,
        taskTitle: task.title,
        expectedResult: null,
        expectedResultSource: 'none',
        executionCount: executions.length,
        comparableCount: 0,
        repeatabilityScore: null,
        verdict: 'no_baseline',
        findings: [
          'No expected result defined and no golden execution baseline available',
        ],
        perExecution: [],
      };
    }

    const perExecution: TaskRepeatabilityResult['perExecution'] = [];
    const scores: number[] = [];
    const findings: string[] = [];

    for (const execution of executions) {
      const taskResult = this.findTaskResult(execution, task.id);
      const output = taskResult?.output || null;
      const completedAt = taskResult?.completedAt || execution.completedAt || null;

      if (!output) {
        perExecution.push({
          executionId: execution._id.toString(),
          executionNumber: execution.executionNumber,
          output: null,
          score: null,
          completedAt,
        });
        continue;
      }

      const score = this.computeTextSimilarity(expectedResult!, output);
      scores.push(score);
      perExecution.push({
        executionId: execution._id.toString(),
        executionNumber: execution.executionNumber,
        output,
        score,
        completedAt,
      });
    }

    const comparableCount = scores.length;
    if (comparableCount < MIN_COMPARABLE_EXECUTIONS) {
      return {
        taskId: task.id,
        taskTitle: task.title,
        expectedResult,
        expectedResultSource: source,
        executionCount: executions.length,
        comparableCount,
        repeatabilityScore: null,
        verdict: 'insufficient_data',
        findings: [
          `Only ${comparableCount} comparable execution(s) — need at least ${MIN_COMPARABLE_EXECUTIONS}`,
        ],
        perExecution,
      };
    }

    const avgScore =
      scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance =
      scores.reduce((sum, s) => sum + (s - avgScore) ** 2, 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 20) {
      findings.push(
        `High output variance (stddev=${stdDev.toFixed(1)}) across executions`,
      );
    }

    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    if (maxScore - minScore > 30) {
      findings.push(
        `Score spread is ${maxScore - minScore} points (${minScore.toFixed(0)}–${maxScore.toFixed(0)})`,
      );
    }

    if (avgScore < UNSTABLE_THRESHOLD) {
      findings.push(
        'Average similarity to expected result is low — outputs diverge significantly',
      );
    }

    return {
      taskId: task.id,
      taskTitle: task.title,
      expectedResult,
      expectedResultSource: source,
      executionCount: executions.length,
      comparableCount,
      repeatabilityScore: Math.round(avgScore * 10) / 10,
      verdict: this.scoreToVerdict(avgScore, true),
      findings,
      perExecution,
    };
  }

  private findTaskResult(execution: any, taskId: string) {
    const results = Array.isArray(execution.taskResults)
      ? execution.taskResults
      : [];
    return results.find(
      (r: any) => r.taskId === taskId && r.status === StepStatus.COMPLETED,
    );
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
      if (setB.has(word)) {
        intersection++;
      }
    }

    const union = setA.size + setB.size - intersection;
    if (union === 0) return 0;

    const jaccard = intersection / union;

    const lenRatio =
      Math.min(a.length, b.length) / Math.max(a.length, b.length);

    return Math.round((jaccard * 0.6 + lenRatio * 0.4) * 100 * 10) / 10;
  }

  private computeOverallScore(
    evaluatedTasks: TaskRepeatabilityResult[],
  ): number | null {
    const scored = evaluatedTasks.filter(
      (t) => t.repeatabilityScore !== null,
    );
    if (scored.length === 0) return null;

    const total = scored.reduce((sum, t) => sum + (t.repeatabilityScore ?? 0), 0);
    return Math.round((total / scored.length) * 10) / 10;
  }

  private scoreToVerdict(
    score: number | null,
    hasEvaluated: boolean,
  ): 'stable' | 'unstable' | 'insufficient_data' | 'no_baseline' {
    if (!hasEvaluated) return 'insufficient_data';
    if (score === null) return 'insufficient_data';
    if (score >= STABLE_THRESHOLD) return 'stable';
    if (score >= UNSTABLE_THRESHOLD) return 'unstable';
    return 'unstable';
  }

  private emptySummary(playbookId: string): PlaybookRepeatabilitySummary {
    return {
      playbookId,
      overallScore: null,
      overallVerdict: 'no_baseline',
      totalTasks: 0,
      evaluatedTasks: 0,
      tasks: [],
      generatedAt: new Date().toISOString(),
    };
  }
}
