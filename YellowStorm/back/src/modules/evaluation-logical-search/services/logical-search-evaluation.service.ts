import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as XLSX from 'xlsx';
import { PlaybookFlowExecutionService } from '../../playbook-flow/services/playbook-flow-execution.service';
import { AgentService } from '../../agent/agent.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { NotFoundException } from '../../exceptions/exceptions/http.exceptions';
import { LogicalSearchEvaluationRepository } from '../repositories/logical-search-evaluation.repository';
import type { EvaluationListScope } from '../repositories/logical-search-evaluation.repository';
import { parseBenchmarkWorkbook } from './xlsx-benchmark-parser';
import {
  buildQueryResult,
  buildSummary,
  EvaluationQueryResult,
  EvaluationRunSummary,
  EvaluationProgress,
  selectBenchmarkQueries,
  toolCallsDurationMs,
  answerToolDurationMs,
} from './evaluation-metrics';
import {
  buildExecutionLogsExport,
  buildExportArchive,
  buildExportFilename,
  truncateExportRow,
} from './evaluation-export.util';
import {
  buildReportModel,
  EvaluationNarrative,
} from './evaluation-report';

const ALLOWED_EXTENSIONS = ['.xlsx', '.csv'];
const ORPHAN_RUN_MAX_AGE_MS = 15 * 60 * 1000;

function mergeTokenUsage(
  a?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; [key: string]: unknown },
  b?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; [key: string]: unknown },
): { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; [key: string]: unknown } | undefined {
  if (!a && !b) return undefined;
  const total = (a?.total_tokens ?? 0) + (b?.total_tokens ?? 0);
  const prompt = (a?.prompt_tokens ?? 0) + (b?.prompt_tokens ?? 0);
  const completion = (a?.completion_tokens ?? 0) + (b?.completion_tokens ?? 0);
  const hasAny = typeof a?.total_tokens === 'number' || typeof a?.prompt_tokens === 'number' || typeof a?.completion_tokens === 'number' ||
                 typeof b?.total_tokens === 'number' || typeof b?.prompt_tokens === 'number' || typeof b?.completion_tokens === 'number';
  if (!hasAny) return undefined;
  return {
    total_tokens: total > 0 ? total : undefined,
    prompt_tokens: prompt > 0 ? prompt : undefined,
    completion_tokens: completion > 0 ? completion : undefined,
  };
}

interface PreparedConfig {
  request_template_path?: string;
  answer_node_id?: string;
  benchmark_queries_member?: string;
  output_directory?: string;
  query_path?: string[];
  additional_query_paths?: string[][];
}

interface PreparedTemplate {
  execution_id: string;
  flow_id: string;
  owner_id: string;
  snapshot: Record<string, unknown>;
  [key: string]: unknown;
}

interface BenchmarkQuery {
  query_id: string;
  query: string;
  answer?: string;
  required_file?: unknown;
  page?: unknown;
}

function setDeepPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const existing = current[key];
    if (existing && typeof existing === 'object') {
      current = existing as Record<string, unknown>;
    } else {
      const nextIsIndex = /^\d+$/.test(path[i + 1] ?? '');
      current[key] = nextIsIndex ? [] : {};
      current = current[key] as Record<string, unknown>;
    }
  }
  current[path[path.length - 1]] = value;
}

@Injectable()
export class LogicalSearchEvaluationService implements OnModuleInit {
  private readonly logger = new Logger(LogicalSearchEvaluationService.name);
  // Evaluation ids with a live run in THIS process, mapped to a stop flag.
  // A DB row still 'running' but absent here is an orphan (previous process
  // died) and can be rescued directly.
  private readonly activeRuns = new Map<string, boolean>();

  async onModuleInit() {
    await this.sweepOrphanedRuns();
  }

  @Interval(ORPHAN_RUN_MAX_AGE_MS)
  async sweepOrphanedRuns() {
    try {
      const orphans = await this.repository.listStaleRunning(ORPHAN_RUN_MAX_AGE_MS);
      for (const orphan of orphans) {
        if (this.activeRuns.has(orphan.id)) continue;
        this.logger.warn(`Auto-rescuing orphaned running evaluation ${orphan.id} (updated ${orphan.updatedAt?.toISOString()})`);
        await this.repository.applyRunComplete(orphan.id, {
          summary: null,
          error: 'Interrupted or orphaned run; auto-marked failed.',
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to sweep orphaned runs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  constructor(
    private readonly repository: LogicalSearchEvaluationRepository,
    private readonly config: ConfigService,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly agentService: AgentService,
  ) {
    const configuredBatchSize = Number(this.config.get<string>('EVAL_BATCH_SIZE', '2'));
    this.evalBatchSize = Number.isFinite(configuredBatchSize) && configuredBatchSize > 0
      ? Math.floor(configuredBatchSize)
      : 2;
  }

  // Targets run in parallel batches; judge submissions share the same cap.
  private readonly evalBatchSize: number;

  private boundedConcurrency<T>(limit: number): <R>(task: () => Promise<R>) => Promise<R> {
    let active = 0;
    const queue: Array<() => void> = [];
    return async <R>(task: () => Promise<R>): Promise<R> => {
      if (active >= limit) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      active++;
      try {
        return await task();
      } finally {
        active--;
        const next = queue.shift();
        if (next) next();
      }
    };
  }

  async uploadAndParse(
    ownerId: string,
    fileName: string,
    buffer: Buffer,
  ) {
    const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      throw new BadRequestException(
        `Unsupported file type "${extension}". Accepted: ${ALLOWED_EXTENSIONS.join(', ')}.`,
      );
    }
    const parsed = parseBenchmarkWorkbook(buffer);
    const evaluation = await this.repository.create({
      ownerId,
      name: fileName.replace(/\.[^.]+$/, ''),
      sourceFileName: fileName,
      queryCount: parsed.queries.length,
      queries: { queries: parsed.queries },
    });
    return {
      evaluationId: evaluation.id,
      fileName,
      sheetName: parsed.sheetName,
      queryCount: parsed.queries.length,
      skippedRows: parsed.skippedRows,
      preview: parsed.queries.slice(0, 5),
    };
  }

  async getById(ownerId: string, id: string) {
    const evaluation = await this.repository.findById(id);
    if (!evaluation || evaluation.ownerId !== ownerId) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Evaluation not found');
    }
    return evaluation;
  }

  /**
   * Start a fresh evaluation seeded from an existing benchmark dataset, so the
   * same questions can be re-tested without re-uploading the file. The source
   * evaluation is left untouched.
   */
  async duplicate(ownerId: string, sourceId: string) {
    const source = await this.getById(ownerId, sourceId);
    const queries = (source.queries as { queries?: unknown[] } | null)?.queries;
    if (!Array.isArray(queries) || queries.length === 0) {
      throw new BadRequestException('Benchmark has no queries to reuse.');
    }
    // Each launch clones the benchmark; a timestamped name keeps runs distinct
    // in the history instead of showing N identical rows.
    const created = await this.repository.create({
      ownerId,
      name: `${source.name} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      sourceFileName: source.sourceFileName,
      queryCount: queries.length,
      queries: { queries },
    });
    return {
      evaluationId: created.id,
      name: created.name,
      sourceFileName: created.sourceFileName,
      queryCount: created.queryCount,
    };
  }

  async listByOwner(
    ownerId: string,
    opts: { limit?: number; offset?: number; scope?: EvaluationListScope } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const [items, total] = await Promise.all([
      this.repository.listByOwner(ownerId, { limit, offset, scope: opts.scope }),
      this.repository.countByOwner(ownerId, opts.scope),
    ]);
    return { items, total };
  }

  async remove(ownerId: string, id: string) {
    await this.getById(ownerId, id);
    await this.repository.deleteById(id);
    return { id, deleted: true };
  }

  /**
   * Ad-hoc prepare: build a synthetic single-node snapshot from a user-selected
   * agent (workspace/model optional) instead of a playbook execution. Produces
   * the same evaluator inputs (request_template.json, config.json, dataset.zip)
   * plus adhoc-config.json for traceability.
   */
  async prepareAdhoc(
    ownerId: string,
    evaluationId: string,
    input: { agentId: string; workspaceId?: string; modelId?: string; fileScope?: string[]; evaluatorAgentId: string; evaluatorModelId?: string },
  ) {
    const evaluation = await this.getById(ownerId, evaluationId);
    if (evaluation.status === 'running' || evaluation.status === 'completed') {
      throw new BadRequestException(
        `Evaluation is ${evaluation.status}; create a new evaluation to re-prepare.`,
      );
    }

    const targetAgentId = input.agentId?.trim() ?? '';
    if (!targetAgentId) {
      throw new BadRequestException('agentId is required.');
    }
    const evaluatorAgentId = input.evaluatorAgentId?.trim() ?? '';
    if (!evaluatorAgentId) {
      throw new BadRequestException('evaluatorAgentId is required.');
    }
    const accessible = await this.agentService.findByIds([targetAgentId, evaluatorAgentId], ownerId);
    if (accessible.length < 2) {
      throw new BadRequestException('One or both agents not found or not accessible.');
    }
    const workspaceId = input.workspaceId?.trim() ?? '';
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required for ad-hoc evaluation.');
    }

    // Node 1: Target Agent - generates answer from question
    const targetNode = {
      id: 'eval-target',
      kind: 'step',
      label: 'Target Answer',
      modelId: input.modelId?.trim() || undefined,
      metadata: {
        assignedAgentId: targetAgentId,
        description: '',
      },
    };

    // Node 2: Evaluator Agent (LLM Judge) - receives question + expected + target answer, outputs score JSON
    const evaluatorNode = {
      id: 'eval-judge',
      kind: 'step',
      label: 'LLM Judge',
      modelId: input.evaluatorModelId?.trim() || undefined,
      metadata: {
        assignedAgentId: evaluatorAgentId,
        description: '',
      },
    };

    const snapshot = {
      nodes: [targetNode, evaluatorNode],
      controlEdges: [
        {
          id: 'edge-target-to-judge',
          kind: 'sequential', // ADK only wires 'sequential'/'conditional' edges; 'default' is silently dropped.
          source: 'eval-target',
          target: 'eval-judge',
          routerLabel: '',
          priority: 0,
          sourceOutputPortId: '',
          targetInputPortId: '',
        },
      ],
      dataBindings: [
        {
          id: 'binding-target-output-to-judge-input',
          sourceKind: 'node-output',
          sourceNode: 'eval-target',
          sourcePort: 'output',
          targetNode: 'eval-judge',
          targetPort: 'target_answer',
          iteration: 'current',
        },
        {
          // Feeds the judge's {retrieved_context} via the executor's search/tool trace.
          id: 'binding-target-trace-to-judge-context',
          sourceKind: 'node-output',
          sourceNode: 'eval-target',
          sourcePort: 'tool_trace',
          targetNode: 'eval-judge',
          targetPort: 'retrieved_context',
          iteration: 'current',
        },
      ],
      settings: {
        recursionLimit: 25,
        maxParallelism: 5,
      },
      workspaces: [workspaceId],
    };

    const requestTemplate = {
      execution_id: `eval-${evaluationId}-adhoc`,
      flow_id: `eval-flow-${evaluationId}`,
      owner_id: ownerId,
      snapshot,
      input_context: { query: '', expected_answer: '' },
      settings: { recursion_limit: 25, max_parallelism: 5 },
      seeded_task_outputs: [],
    };
    const evaluatorConfig = {
      answer_node_id: 'eval-judge',
      target_node_id: 'eval-target',
      query_path: ['input_context', 'query'],
      additional_query_paths: [
        ['snapshot', 'nodes', '0', 'metadata', 'description'],
        ['input_context', 'expected_answer'],
      ],
    };
    // Persist everything the run needs (config + gRPC request template +
    // evaluator agent) so nothing depends on the local filesystem.
    const prepared = {
      config: evaluatorConfig,
      template: requestTemplate,
      evaluatorAgentId,
      evaluatorModelId: input.evaluatorModelId ?? null,
      fileScope: input.fileScope ?? [],
      createdAt: new Date().toISOString(),
    };

    const updated = await this.repository.applyPrepare({
      id: evaluationId,
      agentId: targetAgentId,
      flowId: null,
      workspaceId: input.workspaceId ?? evaluation.workspaceId,
      executionId: null,
      modelId: input.modelId ?? null,
      answerNodeId: 'eval-judge',
      status: 'prepared',
      prepared,
    });
    return {
      evaluationId,
      runDir: '',
      answerNodeId: 'eval-judge',
      targetNodeId: 'eval-target',
      flowId: `eval-flow-${evaluationId}`,
      files: [],
      status: updated?.status ?? 'prepared',
    };
  }

  async run(ownerId: string, evaluationId: string, options: { queryIds?: string[] } = {}) {
    const evaluation = await this.getById(ownerId, evaluationId);
    const targetQueryIds = (options.queryIds ?? []).map((id) => id.trim()).filter(Boolean);
    const isTargeted = targetQueryIds.length > 0;
    let rescued = false;
    if (evaluation.status === 'running') {
      if (this.activeRuns.has(evaluationId)) {
        throw new BadRequestException(`Evaluation is already running.`);
      }
      this.logger.warn(`Rescuing orphaned running evaluation ${evaluationId} (not active in this process)`);
      await this.repository.applyRunComplete(evaluationId, {
        summary: null,
        error: 'Interrupted or orphaned run; resuming.',
      });
      rescued = true;
    }
    if (evaluation.status === 'completed' && !isTargeted) {
      throw new BadRequestException(`Evaluation is already completed; create a new evaluation to re-run.`);
    }
    const allowedStatuses = isTargeted ? ['prepared', 'failed', 'completed'] : ['prepared', 'failed'];
    if (!allowedStatuses.includes(evaluation.status) && !rescued) {
      throw new BadRequestException(`Evaluation is ${evaluation.status}; run prepare first.`);
    }

    const prepared = (evaluation.prepared ?? null) as {
      config?: PreparedConfig;
      template?: PreparedTemplate;
    } | null;
    const config: PreparedConfig = prepared?.config ?? {};
    const template = prepared?.template;
    if (!template) {
      throw new BadRequestException('Evaluation is not prepared; call prepare first.');
    }
    const benchmark = (evaluation.queries ?? {}) as { queries?: BenchmarkQuery[] };
    const allQueries = Array.isArray(benchmark.queries) ? benchmark.queries : [];
    if (allQueries.length === 0) {
      throw new BadRequestException('Benchmark has no queries.');
    }
    const queries = selectBenchmarkQueries(allQueries, targetQueryIds);
    if (queries.length === 0) {
      throw new BadRequestException(`Unknown query id(s): ${targetQueryIds.join(', ')}`);
    }

    await this.repository.applyRunStart(evaluationId);
    this.activeRuns.set(evaluationId, false);

    const queryPath = config.query_path ?? ['input_context', 'query'];
    const additionalQueryPaths = config.additional_query_paths ?? [];
    const answerNodeId = config.answer_node_id ?? evaluation.answerNodeId ?? undefined;
    // A targeted run always re-executes its single query; a full run resumes
    // from the results already stored in Postgres.
    let results: EvaluationQueryResult[] = [];
    if (!isTargeted) {
      results = await this.repository.listResults(evaluationId);
    }
    const doneQueryIds = new Set(
      results.filter((r) => r.status === 'completed').map((r) => r.query_id),
    );
    const runStartedAt = new Date().toISOString();
    let runError: string | null = null;
    let stopped = false;

    try {
      // Rebuild results indexed by query order, keeping any resumed entries.
      const queryIndexById = new Map(queries.map((q, i) => [q.query_id, i]));
      const resultsByIndex: (EvaluationQueryResult | null)[] = new Array(queries.length).fill(null);
      for (const res of results) {
        const idx = queryIndexById.get(res.query_id);
        if (idx !== undefined) resultsByIndex[idx] = res;
      }

      const pending: { index: number; benchmarkQuery: BenchmarkQuery }[] = [];
      for (let i = 0; i < queries.length; i++) {
        if (!doneQueryIds.has(queries[i].query_id)) {
          pending.push({ index: i, benchmarkQuery: queries[i] });
        }
      }

      // Serialized per-completed-answer persistence: queries finish in parallel,
      // so file/DB writes are chained to stay ordered and corruption-free.
      let fileWriteChain: Promise<void> = Promise.resolve();
      const persist = (completed: { index: number; queryId: string; queryText: string }): void => {
        fileWriteChain = fileWriteChain.then(async () => {
          const result = resultsByIndex[completed.index];
          if (!result) return;
          const snapshotResults = resultsByIndex.filter((r): r is EvaluationQueryResult => r !== null);
          await this.repository.applyProgress(evaluationId, {
            done: snapshotResults.length,
            total: queries.length,
            currentIndex: completed.index,
            currentQueryId: completed.queryId,
            currentQuery: completed.queryText,
            startedAt: runStartedAt,
            updatedAt: new Date().toISOString(),
          } satisfies EvaluationProgress);
          await this.repository.applyResult(evaluationId, result);
        }).catch((writeError) => {
          this.logger.warn(
            `[${completed.queryId}] failed to persist run output: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
          );
        });
      };

      // 1) eval-target per batch in parallel; 2) eval-judge submitted the moment
      // its target completes, with concurrency capped at the same batch size.
      for (let offset = 0; offset < pending.length; offset += this.evalBatchSize) {
        if (this.activeRuns.get(evaluationId) === true) {
          stopped = true;
          break;
        }
        const batch = pending.slice(offset, offset + this.evalBatchSize);
        const runInBackground = this.boundedConcurrency(this.evalBatchSize);

        await Promise.all(batch.map(async ({ index, benchmarkQuery }) => {
          const queryId = benchmarkQuery.query_id;
          const queryText = benchmarkQuery.query;
          const startedAt = Date.now();

          const payload = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
          payload.execution_id = `eval-${evaluationId}-${queryId}`;
          payload.seeded_task_outputs = [];
          setDeepPath(payload, queryPath, queryText);
          for (const path of additionalQueryPaths) {
            // expected_answer must carry the benchmark answer, not the question.
            if (Array.isArray(path) && path.join('.') === 'input_context.expected_answer') {
              setDeepPath(payload, path, benchmarkQuery.answer ?? '');
            } else {
              setDeepPath(payload, path, queryText);
            }
          }
          const snapshot = (payload.snapshot ?? {}) as Record<string, unknown>;
          const targetInputContext = { query: queryText };
          const judgeInputContext = { query: queryText, expected_answer: benchmarkQuery.answer ?? '' };

          try {
            const targetRun = await this.executionService.runEvaluationTarget({
              executionId: `eval-${evaluationId}-${queryId}-target`,
              flowId: template.flow_id,
              ownerId,
              snapshot,
              inputContext: targetInputContext,
            });
            if (targetRun.status !== 'completed') {
              resultsByIndex[index] = buildQueryResult({
                queryId,
                query: queryText,
                expectedAnswer: benchmarkQuery.answer ?? '',
                requiredFile: benchmarkQuery.required_file ?? null,
                page: benchmarkQuery.page ?? null,
                generatedAnswer: targetRun.targetAnswer,
                status: targetRun.status,
                durationMs: targetRun.durationMs,
                targetDurationMs: targetRun.durationMs,
                error: targetRun.error,
                toolCalls: targetRun.toolCalls,
                tokenUsage: targetRun.tokenUsage,
                targetTokenUsage: targetRun.tokenUsage,
              });
              this.logger.log(`[${queryId}] ${targetRun.status} (target failed; judge skipped)`);
              persist({ index, queryId, queryText });
              return;
            }

            const retrievedContext = targetRun.toolCalls.find((t) => t.nodeId === 'eval-target')?.trace ?? [];
            const judgeRun = await runInBackground(async () => this.executionService.runEvaluationJudge({
              executionId: `eval-${evaluationId}-${queryId}-judge`,
              flowId: template.flow_id,
              ownerId,
              snapshot,
              inputContext: judgeInputContext,
              targetAnswer: targetRun.targetAnswer,
              retrievedContext,
            }));

            const judgeStatus = judgeRun.status === 'completed' ? 'completed' : 'failed';
            const mergedTokenUsage = mergeTokenUsage(targetRun.tokenUsage, judgeRun.tokenUsage);
            resultsByIndex[index] = buildQueryResult({
              queryId,
              query: queryText,
              expectedAnswer: benchmarkQuery.answer ?? '',
              requiredFile: benchmarkQuery.required_file ?? null,
              page: benchmarkQuery.page ?? null,
              generatedAnswer: targetRun.targetAnswer,
              status: judgeStatus,
              durationMs: targetRun.durationMs + judgeRun.durationMs,
              targetDurationMs: targetRun.durationMs,
              judgeDurationMs: judgeRun.durationMs,
              error: judgeRun.error ?? targetRun.error,
              toolCalls: targetRun.toolCalls,
              tokenUsage: mergedTokenUsage,
              targetTokenUsage: targetRun.tokenUsage,
              judgeTokenUsage: judgeRun.tokenUsage,
              judgeScore: judgeRun.judgeScore,
              judgeFaithfulnessScore: judgeRun.judgeFaithfulnessScore,
              judgeReasoning: judgeRun.judgeReasoning,
            });
            const totalMs = targetRun.durationMs + judgeRun.durationMs;
            this.logger.log(`[${queryId}] ${judgeStatus} in ${String(totalMs)}ms${judgeRun.judgeScore !== undefined ? ` | judge: ${judgeRun.judgeScore}` : ''}`);
            persist({ index, queryId, queryText });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startedAt;
            resultsByIndex[index] = buildQueryResult({
              queryId,
              query: queryText,
              expectedAnswer: benchmarkQuery.answer ?? '',
              requiredFile: benchmarkQuery.required_file ?? null,
              page: benchmarkQuery.page ?? null,
              generatedAnswer: '',
              status: 'failed',
              durationMs,
              error: message,
              toolCalls: [],
              tokenUsage: undefined,
            });
            this.logger.warn(`[${queryId}] failed: ${message}`);
            persist({ index, queryId, queryText });
          }
        }));
      }

      // Ensure every queued per-answer write is flushed before finalizing.
      await fileWriteChain;
      results = resultsByIndex.filter((r): r is EvaluationQueryResult => r !== null);

      await this.repository.applyProgress(evaluationId, {
        done: queries.length,
        total: queries.length,
        currentIndex: queries.length,
        currentQueryId: '',
        currentQuery: '',
        startedAt: runStartedAt,
        updatedAt: new Date().toISOString(),
      } satisfies EvaluationProgress);
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
    } finally {
      this.activeRuns.delete(evaluationId);
    }

    if (stopped) {
      runError = 'Stopped by user; partial results kept.';
      await this.repository.applyProgress(evaluationId, {
        done: results.length,
        total: queries.length,
        currentIndex: Math.min(results.length, queries.length),
        currentQueryId: '',
        currentQuery: '',
        startedAt: runStartedAt,
        updatedAt: new Date().toISOString(),
      } satisfies EvaluationProgress);
    }

    const summary: EvaluationRunSummary = buildSummary(results);
    const finalStatus: 'completed' | 'failed' = runError ? 'failed' : 'completed';
    await this.repository.applyRunComplete(evaluationId, { summary, error: runError });

    return {
      evaluationId,
      status: finalStatus,
      queryCount: results.length,
      summary,
    };
  }

  async stop(ownerId: string, evaluationId: string) {
    const evaluation = await this.getById(ownerId, evaluationId);
    if (evaluation.status !== 'running') {
      throw new BadRequestException(`Evaluation is ${evaluation.status}; nothing to stop.`);
    }
    if (!this.activeRuns.has(evaluationId)) {
      this.logger.warn(`Stop requested on orphaned running evaluation ${evaluationId}; marking failed directly`);
      await this.repository.applyRunComplete(evaluationId, {
        summary: null,
        error: 'Stopped by user.',
      });
      return { evaluationId, status: 'failed' };
    }
    this.logger.log(`Stop requested for evaluation ${evaluationId}; set at next query boundary`);
    this.activeRuns.set(evaluationId, true);
    return { evaluationId, status: 'running', signal: 'stopping' };
  }

  /**
   * Results for a run, rebuilt from the payloads stored in Postgres. Order
   * follows the benchmark (the results table is keyed by query id).
   */
  private async readRunResults(evaluationId: string): Promise<EvaluationQueryResult[]> {
    return this.repository.listResults(evaluationId);
  }

  async getProgress(ownerId: string, evaluationId: string) {
    const evaluation = await this.getById(ownerId, evaluationId);
    return {
      evaluationId,
      status: evaluation.status,
      progress: (evaluation.progress as EvaluationProgress | null) ?? null,
    };
  }

  async getResults(ownerId: string, evaluationId: string) {
    const evaluation = await this.getById(ownerId, evaluationId);
    const results = await this.readRunResults(evaluationId);
    // Recompute from raw results so summary fields introduced after the run
    // (e.g. judge_exact_match_rate) are also present for older evaluations.
    const summary = results.length > 0 ? buildSummary(results) : null;
    return { evaluationId, status: evaluation.status, queryCount: results.length, summary, results };
  }

  async getReport(ownerId: string, evaluationId: string) {
    const evaluation = await this.getById(ownerId, evaluationId);
    return {
      report: (evaluation.narrative as EvaluationNarrative | null) ?? null,
      defaultAgentId: this.config.get<string>('EVALUATION_INTERPRETER_AGENT_ID') ?? null,
    };
  }

  /**
   * Generate (or regenerate) the narrative report by running the interpreter
   * agent on the deterministic report model. Overwrites the previous report.
   */
  async generateReport(
    ownerId: string,
    evaluationId: string,
    input: { agentId: string; locale?: string },
  ) {
    const agentId = input.agentId?.trim() ?? '';
    if (!agentId) {
      throw new BadRequestException('agentId is required.');
    }
    const accessible = await this.agentService.findByIds([agentId], ownerId);
    if (accessible.length === 0) {
      throw new BadRequestException('Interpreter agent not found or not accessible.');
    }

    const results = await this.readRunResults(evaluationId);
    if (results.length === 0) {
      throw new BadRequestException('No run output yet; run the evaluation first.');
    }
    const summary = buildSummary(results);

    const locale = input.locale === 'fr' ? 'fr' : 'en';
    const payload = JSON.stringify({ locale, report: buildReportModel(results, summary) });
    // Reuse the eval-target plumbing: a single synthetic node whose assigned
    // agent is the interpreter, receiving the report model as its question.
    const snapshot = {
      nodes: [
        {
          id: 'eval-target',
          kind: 'step',
          label: 'Evaluation Interpreter',
          metadata: { assignedAgentId: agentId, description: payload },
        },
      ],
      controlEdges: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
    };

    const run = await this.executionService.runEvaluationTarget({
      executionId: `eval-${evaluationId}-interpreter`,
      flowId: `eval-flow-${evaluationId}`,
      ownerId,
      snapshot,
      inputContext: { query: payload },
    });
    const text = run.targetAnswer?.trim() ?? '';
    if (run.status !== 'completed' || !text) {
      throw new BadRequestException(run.error || 'Interpreter agent did not return a report.');
    }

    const narrative: EvaluationNarrative = {
      generatedAt: new Date().toISOString(),
      agentId,
      interpreterTokens: run.tokenUsage ?? null,
      content: text,
    };
    await this.repository.applyNarrative(evaluationId, narrative);
    return { report: narrative, defaultAgentId: agentId };
  }

  async exportArchive(
    ownerId: string,
    evaluationId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const evaluation = await this.getById(ownerId, evaluationId);
    const results = await this.readRunResults(evaluationId);
    if (results.length === 0) {
      throw new BadRequestException('No run output yet; run the evaluation first.');
    }
    const summary = buildSummary(results);

    const meanOf = (values: number[]): number =>
      values.length > 0 ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;
    const toolDurationValues = results.map((r) => toolCallsDurationMs(r.tool_calls ?? []));
    const answerDurationValues = results
      .map((r) => answerToolDurationMs(r.tool_calls ?? []))
      .filter((value): value is number => value !== null && value > 0);

    const summarySheetData = [
      { Metric: 'Total Queries', Value: summary.query_count },
      { Metric: 'Mean Semantic Similarity', Value: summary.mean_semantic_similarity },
      { Metric: 'Mean Fact Recall', Value: summary.mean_fact_recall },
      { Metric: 'Mean Fact Precision', Value: summary.mean_fact_precision },
      { Metric: 'Mean Answer Quality', Value: summary.mean_answer_quality },
      { Metric: 'Mean Retrieval Recall (File)', Value: summary.mean_file_recall },
      { Metric: 'Mean Retrieval Precision (File)', Value: summary.mean_file_precision },
      { Metric: 'Mean Tool Calls Duration (ms)', Value: meanOf(toolDurationValues) },
      { Metric: 'Mean Answer Tool Duration (ms)', Value: meanOf(answerDurationValues) },
    ];

    const toCellText = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object') return Array.isArray(value) ? value.map(toCellText).join(', ') : JSON.stringify(value);
      return JSON.stringify(value);
    };

    const detailHeaders = [
      'Query ID', 'Query', 'Expected Answer', 'Expected File', 'Expected Page',
      'Generated Answer', 'Retrieved Files',
      'Retrieval Recall', 'Retrieval Precision',
      'Semantic Similarity', 'Fact Recall', 'Fact Precision', 'Answer Quality',
      'Judge Score', 'Judge Faithfulness', 'Judge Reasoning',
      'Status', 'Duration (ms)', 'Target Duration (ms)', 'Judge Duration (ms)',
      'Tool Calls Duration (ms)', 'Answer Tool Duration (ms)', 'Error',
      'Execution Logs / Tool Calls', 'Token Usage',
      'Target Prompt Tokens', 'Target Completion Tokens', 'Target Total Tokens',
      'Judge Prompt Tokens', 'Judge Completion Tokens', 'Judge Total Tokens',
      'Global Total Tokens',
    ] as const;

    const detailsSheetData = results.map((r) => {
      const ret = r.metrics.retrieval;
      const ans = r.metrics.answer;
      const toolCallsText = r.tool_calls && r.tool_calls.length > 0
        ? (r.tool_calls as Array<Record<string, unknown>>).map((tc) => {
            const fn = tc['function'] as Record<string, unknown> | undefined;
            const name = String(tc['tool_name'] ?? tc['name'] ?? fn?.['name'] ?? 'unknown_tool');
            const input = tc['args'] ?? tc['input'] ?? tc['parameters'] ?? {};
            const output = tc['output'] ?? tc['result'] ?? tc['output_summary'] ?? tc['response'] ?? {};
            const duration = typeof tc['duration_ms'] === 'number' ? tc['duration_ms'] : (typeof tc['execution_time'] === 'number' ? tc['execution_time'] : undefined);
            return `[${name}] input=${JSON.stringify(input)} output=${JSON.stringify(output)}${duration !== undefined ? ` duration_ms=${duration}` : ''}`;
          }).join(' | ')
        : '';
      const tokenUsageText = r.token_usage
        ? `Total: ${r.token_usage.total_tokens ?? 'N/A'} | Prompt: ${r.token_usage.prompt_tokens ?? 'N/A'} | Completion: ${r.token_usage.completion_tokens ?? 'N/A'}`
        : '';
      return {
        'Query ID': r.query_id,
        'Query': r.query,
        'Expected Answer': r.expected_answer,
        'Expected File': toCellText(r.required_file),
        'Expected Page': toCellText(r.page),
        'Generated Answer': r.generated_answer,
        'Retrieved Files': toCellText(ret.retrieved_files),
        'Retrieval Recall': ret.file_recall,
        'Retrieval Precision': ret.file_precision,
        'Semantic Similarity': ans.semantic_similarity,
        'Fact Recall': ans.fact_recall,
        'Fact Precision': ans.fact_precision,
        'Answer Quality': ans.answer_quality,
        'Judge Score': r.judge_score ?? '',
        'Judge Faithfulness': r.judge_faithfulness_score ?? '',
        'Judge Reasoning': r.judge_reasoning ?? '',
        'Status': r.status,
        'Duration (ms)': r.duration_ms,
        'Target Duration (ms)': r.target_duration_ms ?? '',
        'Judge Duration (ms)': r.judge_duration_ms ?? '',
        'Tool Calls Duration (ms)': toolCallsDurationMs(r.tool_calls ?? []),
        'Answer Tool Duration (ms)': answerToolDurationMs(r.tool_calls ?? []) ?? '',
        'Error': r.error ?? '',
        'Execution Logs / Tool Calls': toolCallsText,
        'Token Usage': tokenUsageText,
        'Target Prompt Tokens': r.target_token_usage?.prompt_tokens ?? '',
        'Target Completion Tokens': r.target_token_usage?.completion_tokens ?? '',
        'Target Total Tokens': r.target_token_usage?.total_tokens ?? '',
        'Judge Prompt Tokens': r.judge_token_usage?.prompt_tokens ?? '',
        'Judge Completion Tokens': r.judge_token_usage?.completion_tokens ?? '',
        'Judge Total Tokens': r.judge_token_usage?.total_tokens ?? '',
        'Global Total Tokens': r.token_usage?.total_tokens ?? '',
      };
    }).map(truncateExportRow);

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(summarySheetData);
    summarySheet['!cols'] = [{ wch: 35 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Global Summary');

    const detailsSheet = XLSX.utils.json_to_sheet(detailsSheetData);
    detailsSheet['!cols'] = detailHeaders.map((header) => {
      let maxLength = header.length;
      for (const row of detailsSheetData) {
        const width = toCellText(row[header]).length;
        if (width > maxLength) maxLength = width;
      }
      return { wch: Math.min(maxLength + 2, 60) };
    });
    XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Detailed Results');

    // Versioning: which model, connector and agents produced this run.
    const prepared = (evaluation.prepared ?? null) as { evaluatorAgentId?: string | null } | null;
    const evaluatorAgentId = prepared?.evaluatorAgentId ?? null;
    const runMetadata = await this.repository.findRunMetadata({
      agentId: evaluation.agentId ?? null,
      evaluatorAgentId,
    });
    const targetAgent = runMetadata.agents.find((agent) => agent.id === evaluation.agentId);
    const judgeAgent = runMetadata.agents.find((agent) => agent.id === evaluatorAgentId);
    const versioningSheetData = [
      { Field: 'Model', Value: targetAgent?.model || evaluation.modelId || '(default)' },
      { Field: 'Temperature', Value: targetAgent?.temperature ?? '' },
      { Field: 'Agent', Value: targetAgent?.name ?? evaluation.agentId ?? '' },
      { Field: 'Connector', Value: runMetadata.connectors.join(', ') },
      { Field: 'Judge agent', Value: judgeAgent?.name ?? '' },
      { Field: 'Judge model', Value: judgeAgent?.model ?? '' },
      { Field: 'Workspace', Value: evaluation.workspaceId ?? '' },
      { Field: 'Answer node', Value: evaluation.answerNodeId ?? '' },
      { Field: 'Evaluation id', Value: evaluationId },
      { Field: 'Created at', Value: evaluation.createdAt instanceof Date ? evaluation.createdAt.toISOString() : '' },
    ];
    const versioningSheet = XLSX.utils.json_to_sheet(versioningSheetData);
    versioningSheet['!cols'] = [{ wch: 18 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(workbook, versioningSheet, 'Versioning');

    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const logsJson = JSON.stringify(buildExecutionLogsExport(evaluationId, results), null, 2);
    const buffer = buildExportArchive({ evaluationId, xlsx: xlsxBuffer, logsJson });
    return { buffer, filename: buildExportFilename() };
  }
}
