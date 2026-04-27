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
export type RepeatabilityMatchState = 'matched' | 'not_matched' | 'not_evaluated';

export interface RepeatabilityTaskExecutionSummary {
  taskId: string;
  taskTitle: string;
  output: string | null;
  completedAt: Date | null;
  expectedResult: string | null;
  expectedResultSource: ExpectedResultSource;
  expectedResultType: string | null;
  expectedResultMatched: boolean | null;
  expectedResultReason: string | null;
  matchScore: number | null;
  matchState: RepeatabilityMatchState;
  passed: boolean;
  evaluated: boolean;
}

export interface RepeatabilityIterationSummary {
  executionId: string;
  executionNumber: number;
  completedAt: Date | null;
  taskCount: number;
  evaluatedTasks: number;
  passedTasks: number;
  averageMatchScore: number | null;
  passed: boolean;
  tasks: RepeatabilityTaskExecutionSummary[];
}

export interface PlaybookRepeatabilitySummary {
  playbookId: string;
  totalIterations: number;
  evaluatedIterations: number;
  passedIterations: number;
  overallAverageMatchScore: number | null;
  generatedAt: string;
  iterations: RepeatabilityIterationSummary[];
}

const MIN_ITERATIONS = 2;
const PASS_SCORE_THRESHOLD = 80;

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
    offset = 0,
  ): Promise<PlaybookRepeatabilitySummary> {
    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    if (!playbook) {
      return this.emptySummary(playbookId);
    }

    const tasks = this.extractTasksFromSnapshot(playbook);
    if (tasks.length === 0) {
      return this.emptySummary(playbookId);
    }

    const baseQuery = {
      playbookId: new Types.ObjectId(playbookId),
      status: StepStatus.COMPLETED,
    };

    const totalCount = await this.executionModel.countDocuments(baseQuery);

    if (totalCount < MIN_ITERATIONS) {
      return {
        playbookId,
        totalIterations: totalCount,
        evaluatedIterations: 0,
        passedIterations: 0,
        overallAverageMatchScore: null,
        generatedAt: new Date().toISOString(),
        iterations: [],
      };
    }

    const goldenBaselines = await this.loadGoldenBaselines(
      playbookId,
      tasks.map((t) => t.id),
    );

    const allExecutions = await this.executionModel
      .find(baseQuery)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const allIterations = allExecutions.map((execution) =>
      this.evaluateIteration(execution, tasks, goldenBaselines),
    );

    const evaluatedIterations = allIterations.filter((iter) => iter.evaluatedTasks > 0);
    const passedIterations = evaluatedIterations.filter((iter) => iter.passed);

    const iterationAverages = evaluatedIterations
      .map((iter) => iter.averageMatchScore)
      .filter((score): score is number => score !== null);

    const overallAverageMatchScore = iterationAverages.length > 0
      ? Math.round((iterationAverages.reduce((sum, s) => sum + s, 0) / iterationAverages.length) * 10) / 10
      : null;

    const paginatedIterations = allIterations.slice(offset, offset + limit);

    return {
      playbookId,
      totalIterations: allIterations.length,
      evaluatedIterations: evaluatedIterations.length,
      passedIterations: passedIterations.length,
      overallAverageMatchScore,
      generatedAt: new Date().toISOString(),
      iterations: paginatedIterations,
    };
  }

  async getTaskRepeatability(
    playbookId: string,
    taskId: string,
    limit = 5,
  ): Promise<RepeatabilityTaskExecutionSummary[] | null> {
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
    return executions.map((execution) =>
      this.evaluateTaskExecution(execution, task, goldenBaselines),
    );
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

  private evaluateIteration(
    execution: any,
    tasks: Array<{ id: string; title: string; expectedResult?: string | null }>,
    goldenBaselines: Map<string, string>,
  ): RepeatabilityIterationSummary {
    const executionTasks = tasks.map((task) =>
      this.evaluateTaskExecution(execution, task, goldenBaselines),
    );

    const evaluatedTasks = executionTasks.filter((t) => t.evaluated);
    const passedTasks = executionTasks.filter((t) => t.passed);

    const taskScores = evaluatedTasks
      .map((t) => t.matchScore)
      .filter((score): score is number => score !== null);

    const averageMatchScore = taskScores.length > 0
      ? Math.round((taskScores.reduce((sum, s) => sum + s, 0) / taskScores.length) * 10) / 10
      : null;

    const passed = evaluatedTasks.length > 0 && passedTasks.length === evaluatedTasks.length;

    return {
      executionId: execution._id.toString(),
      executionNumber: execution.executionNumber,
      completedAt: execution.completedAt || null,
      taskCount: executionTasks.length,
      evaluatedTasks: evaluatedTasks.length,
      passedTasks: passedTasks.length,
      averageMatchScore,
      passed,
      tasks: executionTasks,
    };
  }

  private evaluateTaskExecution(
    execution: any,
    task: { id: string; title: string; expectedResult?: string | null },
    goldenBaselines: Map<string, string>,
  ): RepeatabilityTaskExecutionSummary {
    const baseline = goldenBaselines.get(task.id) || null;
    const { value: expectedResult, source: expectedResultSource } = this.resolveExpectedResult(task, baseline);

    const taskResult = this.findTaskResult(execution, task.id);
    const output = taskResult?.output || null;
    const completedAt = taskResult?.completedAt || execution.completedAt || null;
    const judgeResult = taskResult?.judgeResult || null;

    const resolvedJudgeMatched = judgeResult?.expectedResultMatched === true
      || judgeResult?.expectedResultMatched === false
      ? judgeResult.expectedResultMatched
      : null;

    const resolvedJudgeScore = typeof judgeResult?.resultMatchingScore === 'number'
      ? Math.max(0, Math.min(100, judgeResult.resultMatchingScore))
      : null;

    const judgeScore = this.normalizeJudgeResultMatchingScore(judgeResult, expectedResultSource);
    const fallbackScore = expectedResultSource !== 'none' && output
      ? this.computeTextSimilarity(expectedResult!, output)
      : null;

    const matchScore = judgeScore ?? fallbackScore;
    const expectedResultMatched = resolvedJudgeMatched === true
      ? true
      : matchScore !== null
        ? matchScore >= PASS_SCORE_THRESHOLD
        : resolvedJudgeMatched;

    const evaluated = expectedResultSource !== 'none' && (matchScore !== null || expectedResultMatched !== null);
    const passed = expectedResultMatched === true;

    let matchState: RepeatabilityMatchState;
    if (!evaluated) {
      matchState = 'not_evaluated';
    } else if (expectedResultMatched === true) {
      matchState = 'matched';
    } else {
      matchState = 'not_matched';
    }

    return {
      taskId: task.id,
      taskTitle: task.title,
      output,
      completedAt,
      expectedResult,
      expectedResultSource,
      expectedResultType: typeof judgeResult?.expectedResultType === 'string' ? judgeResult.expectedResultType : 'none',
      expectedResultMatched,
      expectedResultReason: typeof judgeResult?.expectedResultReason === 'string' ? judgeResult.expectedResultReason : null,
      matchScore,
      matchState,
      passed,
      evaluated,
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

  private normalizeJudgeResultMatchingScore(
    judgeResult: { resultMatchingScore?: unknown; expectedResultSource?: unknown } | null | undefined,
    expectedResultSource: ExpectedResultSource,
  ): number | null {
    if (!judgeResult || expectedResultSource === 'none') {
      return null;
    }

    const judgeSource = judgeResult.expectedResultSource;
    if (judgeSource === 'node_field' || judgeSource === 'golden_baseline') {
      if (judgeSource !== expectedResultSource) {
        return null;
      }
    }

    const parsed = typeof judgeResult.resultMatchingScore === 'number'
      ? judgeResult.resultMatchingScore
      : Number(judgeResult.resultMatchingScore);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.max(0, Math.min(100, parsed));
  }

  private emptySummary(playbookId: string): PlaybookRepeatabilitySummary {
    return {
      playbookId,
      totalIterations: 0,
      evaluatedIterations: 0,
      passedIterations: 0,
      overallAverageMatchScore: null,
      generatedAt: new Date().toISOString(),
      iterations: [],
    };
  }
}
