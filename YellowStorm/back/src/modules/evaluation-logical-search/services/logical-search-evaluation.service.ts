import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import AdmZip = require('adm-zip');
import { mkdir, writeFile, readFile, rename, rm } from 'fs/promises';
import { join } from 'path';
import * as XLSX from 'xlsx';
import {
  FlowExecution,
  FlowExecutionDocument,
} from '../../playbook-flow/schemas/playbook-flow-execution.schema';
import { PlaybookFlowExecutionService } from '../../playbook-flow/services/playbook-flow-execution.service';
import { AgentService } from '../../agent/agent.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { NotFoundException } from '../../exceptions/exceptions/http.exceptions';
import { LogicalSearchEvaluationRepository } from '../repositories/logical-search-evaluation.repository';
import { parseBenchmarkWorkbook } from './xlsx-benchmark-parser';
import {
  buildQueryResult,
  buildSummary,
  EvaluationQueryResult,
  EvaluationRunSummary,
  EvaluationProgress,
  selectBenchmarkQueries,
} from './evaluation-metrics';
import {
  buildExecutionLogsExport,
  buildExportArchive,
  buildExportFilename,
  truncateExportRow,
} from './evaluation-export.util';

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

interface SnapshotLike {
  nodes?: { id?: string }[];
  [key: string]: unknown;
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

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf-8')) as T;
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
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
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
    const created = await this.repository.create({
      ownerId,
      name: source.name,
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

  async listByOwner(ownerId: string) {
    return this.repository.listByOwner(ownerId);
  }

  /**
   * Capture the snapshot persisted on a playbook execution and materialize the
   * evaluator inputs (request_template.json, config.json, dataset.zip) under
   * uploads/eval/{evaluationId}/.
   */
  async prepare(
    ownerId: string,
    evaluationId: string,
    input: { executionId: string; agentId?: string; workspaceId?: string },
  ) {
    const evaluation = await this.getById(ownerId, evaluationId);
    if (evaluation.status === 'running' || evaluation.status === 'completed') {
      throw new BadRequestException(
        `Evaluation is ${evaluation.status}; create a new evaluation to re-prepare.`,
      );
    }

    const execution = await this.executionModel
      .findById(input.executionId)
      .select('+snapshot')
      .lean<{ _id?: unknown; ownerId?: string; flowId?: string; snapshot?: SnapshotLike; recursionLimit?: number; maxParallelism?: number }>();
    if (!execution || String(execution.ownerId) !== ownerId) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Execution not found');
    }
    const snapshot = execution.snapshot;
    if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
      throw new BadRequestException(
        'Execution has no persisted snapshot; run the playbook first.',
      );
    }
    // ponytail: mono-node flows only; multi-step flows need an explicit answer node picker.
    const answerNodeId = snapshot.nodes[0]?.id;
    if (!answerNodeId) {
      throw new BadRequestException('Snapshot answer node has no id.');
    }

    const grpcTarget = this.config.get<string>('playbook-flow.grpcUrl') ?? 'localhost:50051';
    const runDir = join(process.cwd(), 'uploads', 'eval', evaluationId);
    const benchmarkPayload = evaluation.queries as { queries?: unknown[] };
    const zipPath = join(runDir, 'dataset.zip');

    const requestTemplate = {
      execution_id: input.executionId,
      flow_id: execution.flowId,
      owner_id: ownerId,
      snapshot,
      input_context: { query: '' },
      settings: {
        recursion_limit: execution.recursionLimit ?? 25,
        max_parallelism: execution.maxParallelism ?? 5,
      },
      seeded_task_outputs: [],
    };
    const evaluatorConfig = {
      grpc_target: grpcTarget,
      grpc_secure: false,
      request_template_path: 'uploads/eval/' + evaluationId + '/request_template.json',
      answer_node_id: answerNodeId,
      benchmark_zip_path: zipPath,
      benchmark_queries_member: 'benchmark_queries.json',
      output_directory: join(runDir, 'outputs'),
      query_path: ['input_context', 'query'],
      // The captured node keeps the manual question in metadata.description;
      // overwrite it or the agent answers the stale question.
      additional_query_paths: [['snapshot', 'nodes', '0', 'metadata', 'description']],
    };

    try {
      await mkdir(runDir, { recursive: true });
      // A new execution captures a new snapshot → previous run outputs are stale.
      await rm(join(runDir, 'results.json'), { force: true });
      await rm(join(runDir, 'summary.json'), { force: true });
      await rm(join(runDir, 'progress.json'), { force: true });
      await rm(join(runDir, 'progress.json.tmp'), { force: true });
      await rm(join(runDir, 'outputs'), { force: true, recursive: true });
      await writeFile(join(runDir, 'benchmark_queries.json'), JSON.stringify(benchmarkPayload), 'utf-8');
      const zip = new AdmZip();
      zip.addFile(
        'benchmark_queries.json',
        Buffer.from(JSON.stringify(benchmarkPayload), 'utf-8'),
      );
      await zip.writeZipPromise(zipPath);
      await writeFile(
        join(runDir, 'request_template.json'),
        JSON.stringify(requestTemplate, null, 2),
        'utf-8',
      );
      await writeFile(join(runDir, 'config.json'), JSON.stringify(evaluatorConfig, null, 2), 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to write evaluator inputs for ${evaluationId}: ${message}`);
      await this.repository.applyPrepare({
        id: evaluationId,
        agentId: input.agentId ?? evaluation.agentId,
        flowId: execution.flowId ?? null,
        workspaceId: input.workspaceId ?? evaluation.workspaceId,
        executionId: input.executionId,
        answerNodeId: null,
        status: 'failed',
        error: message,
      });
      throw new BadRequestException(`Failed to generate evaluator inputs: ${message}`);
    }

    const updated = await this.repository.applyPrepare({
      id: evaluationId,
      agentId: input.agentId ?? evaluation.agentId,
      flowId: execution.flowId ?? null,
      workspaceId: input.workspaceId ?? evaluation.workspaceId,
      executionId: input.executionId,
      answerNodeId,
      status: 'prepared',
    });
    return {
      evaluationId,
      runDir,
      answerNodeId,
      flowId: execution.flowId,
      files: ['benchmark_queries.json', 'dataset.zip', 'request_template.json', 'config.json'],
      status: updated?.status ?? 'prepared',
    };
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

    const grpcTarget = this.config.get<string>('playbook-flow.grpcUrl') ?? 'localhost:50051';
    const runDir = join(process.cwd(), 'uploads', 'eval', evaluationId);
    const benchmarkPayload = evaluation.queries as { queries?: unknown[] };
    const zipPath = join(runDir, 'dataset.zip');

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
      grpc_target: grpcTarget,
      grpc_secure: false,
      request_template_path: 'uploads/eval/' + evaluationId + '/request_template.json',
      answer_node_id: 'eval-judge',
      target_node_id: 'eval-target',
      benchmark_zip_path: zipPath,
      benchmark_queries_member: 'benchmark_queries.json',
      output_directory: join(runDir, 'outputs'),
      query_path: ['input_context', 'query'],
      additional_query_paths: [
        ['snapshot', 'nodes', '0', 'metadata', 'description'],
        ['input_context', 'expected_answer'],
      ],
    };
    const adhocConfig = {
      agentId: targetAgentId,
      evaluatorAgentId,
      workspaceId,
      modelId: input.modelId ?? null,
      evaluatorModelId: input.evaluatorModelId ?? null,
      fileScope: input.fileScope ?? [],
      createdAt: new Date().toISOString(),
    };

    try {
      await mkdir(runDir, { recursive: true });
      await rm(join(runDir, 'results.json'), { force: true });
      await rm(join(runDir, 'summary.json'), { force: true });
      await rm(join(runDir, 'progress.json'), { force: true });
      await rm(join(runDir, 'progress.json.tmp'), { force: true });
      await rm(join(runDir, 'outputs'), { force: true, recursive: true });
      await writeFile(join(runDir, 'benchmark_queries.json'), JSON.stringify(benchmarkPayload), 'utf-8');
      const zip = new AdmZip();
      zip.addFile(
        'benchmark_queries.json',
        Buffer.from(JSON.stringify(benchmarkPayload), 'utf-8'),
      );
      await zip.writeZipPromise(zipPath);
      await writeFile(
        join(runDir, 'request_template.json'),
        JSON.stringify(requestTemplate, null, 2),
        'utf-8',
      );
      await writeFile(join(runDir, 'config.json'), JSON.stringify(evaluatorConfig, null, 2), 'utf-8');
      await writeFile(join(runDir, 'adhoc-config.json'), JSON.stringify(adhocConfig, null, 2), 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to write ad-hoc evaluator inputs for ${evaluationId}: ${message}`);
      await this.repository.applyPrepare({
        id: evaluationId,
        agentId: targetAgentId,
        flowId: null,
        workspaceId: input.workspaceId ?? evaluation.workspaceId,
        executionId: null,
        modelId: input.modelId ?? null,
        answerNodeId: 'eval-judge',
        status: 'failed',
        error: message,
      });
      throw new BadRequestException(`Failed to generate ad-hoc evaluator inputs: ${message}`);
    }

    const updated = await this.repository.applyPrepare({
      id: evaluationId,
      agentId: targetAgentId,
      flowId: null,
      workspaceId: input.workspaceId ?? evaluation.workspaceId,
      executionId: null,
      modelId: input.modelId ?? null,
      answerNodeId: 'eval-judge',
      status: 'prepared',
    });
    return {
      evaluationId,
      runDir,
      answerNodeId: 'eval-judge',
      targetNodeId: 'eval-target',
      flowId: `eval-flow-${evaluationId}`,
      files: ['benchmark_queries.json', 'dataset.zip', 'request_template.json', 'config.json', 'adhoc-config.json'],
      status: updated?.status ?? 'prepared',
    };
  }

  async run(ownerId: string, evaluationId: string, options: { queryId?: string } = {}) {
    const evaluation = await this.getById(ownerId, evaluationId);
    const targetQueryId = options.queryId?.trim() || undefined;
    const isTargeted = Boolean(targetQueryId);
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

    const runDir = join(process.cwd(), 'uploads', 'eval', evaluationId);
    const config = await readJson<PreparedConfig>(join(runDir, 'config.json'));
    const template = await readJson<PreparedTemplate>(join(runDir, 'request_template.json'));
    const benchmark = await readJson<{ queries: BenchmarkQuery[] }>(join(runDir, 'benchmark_queries.json'));
    const allQueries = Array.isArray(benchmark.queries) ? benchmark.queries : [];
    if (allQueries.length === 0) {
      throw new BadRequestException('Benchmark has no queries.');
    }
    const queries = selectBenchmarkQueries(allQueries, targetQueryId);
    if (queries.length === 0) {
      throw new BadRequestException(`Unknown query id: ${targetQueryId}`);
    }

    await this.repository.applyRunStart(evaluationId);
    this.activeRuns.set(evaluationId, false);

    const queryPath = config.query_path ?? ['input_context', 'query'];
    const additionalQueryPaths = config.additional_query_paths ?? [];
    const answerNodeId = config.answer_node_id ?? evaluation.answerNodeId ?? undefined;
    // A targeted run always re-executes its single query and rewrites the run
    // output, so the export only contains that question.
    let results: EvaluationQueryResult[] = [];
    if (!isTargeted) {
      try {
        results = await readJson<EvaluationQueryResult[]>(join(runDir, 'results.json'));
      } catch {
        results = [];
      }
      if (!Array.isArray(results)) results = [];
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
          await writeFile(join(runDir, 'results.json.tmp'), JSON.stringify(snapshotResults, null, 2), 'utf-8');
          await rename(join(runDir, 'results.json.tmp'), join(runDir, 'results.json'));
          await writeFile(join(runDir, 'summary.json'), JSON.stringify(buildSummary(snapshotResults), null, 2), 'utf-8');
          await this.writeProgress(runDir, {
            done: snapshotResults.length,
            total: queries.length,
            currentIndex: completed.index,
            currentQueryId: completed.queryId,
            currentQuery: completed.queryText,
            startedAt: runStartedAt,
            updatedAt: new Date().toISOString(),
          });
          await this.repository.applyRunProgress(evaluationId);
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
          const inputContext = { query: queryText, expected_answer: benchmarkQuery.answer ?? '' };

          try {
            const targetRun = await this.executionService.runEvaluationTarget({
              executionId: `eval-${evaluationId}-${queryId}-target`,
              flowId: template.flow_id,
              ownerId,
              snapshot,
              inputContext,
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
              inputContext,
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

      await this.writeProgress(runDir, {
        done: queries.length,
        total: queries.length,
        currentIndex: queries.length,
        currentQueryId: '',
        currentQuery: '',
        startedAt: runStartedAt,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
    } finally {
      this.activeRuns.delete(evaluationId);
    }

    if (stopped) {
      runError = 'Stopped by user; partial results kept.';
      await this.writeProgress(runDir, {
        done: results.length,
        total: queries.length,
        currentIndex: Math.min(results.length, queries.length),
        currentQueryId: '',
        currentQuery: '',
        startedAt: runStartedAt,
        updatedAt: new Date().toISOString(),
      });
    }

    const summary: EvaluationRunSummary = buildSummary(results);
    let finalStatus: 'completed' | 'failed' = runError ? 'failed' : 'completed';
    try {
      await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    } catch (error) {
      finalStatus = 'failed';
      runError = (runError ? `${runError}; ` : '') + (error instanceof Error ? error.message : String(error));
    }
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

  private async writeProgress(runDir: string, progress: EvaluationProgress): Promise<void> {
    await writeFile(join(runDir, 'progress.json.tmp'), JSON.stringify(progress, null, 2), 'utf-8');
    await rename(join(runDir, 'progress.json.tmp'), join(runDir, 'progress.json'));
  }

  async getProgress(ownerId: string, evaluationId: string) {
    const evaluation = await this.getById(ownerId, evaluationId);
    const runDir = join(process.cwd(), 'uploads', 'eval', evaluationId);
    try {
      const progress = await readJson<EvaluationProgress>(join(runDir, 'progress.json'));
      return { evaluationId, status: evaluation.status, progress };
    } catch {
      return { evaluationId, status: evaluation.status, progress: null };
    }
  }

  async exportArchive(
    ownerId: string,
    evaluationId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.getById(ownerId, evaluationId);
    const runDir = join(process.cwd(), 'uploads', 'eval', evaluationId);
    let results: EvaluationQueryResult[] = [];
    try {
      results = await readJson<EvaluationQueryResult[]>(join(runDir, 'results.json'));
    } catch {
      throw new BadRequestException('No run output yet; run the evaluation first.');
    }
    if (!Array.isArray(results) || results.length === 0) {
      throw new BadRequestException('No run output yet; run the evaluation first.');
    }
    const summary = await readJson<EvaluationRunSummary>(join(runDir, 'summary.json'));

    const summarySheetData = [
      { Metric: 'Total Queries', Value: summary.query_count },
      { Metric: 'Mean Answer Recall (Token)', Value: summary.mean_answer_token_recall },
      { Metric: 'Mean Answer Precision (Token)', Value: summary.mean_answer_token_precision },
      { Metric: 'Mean Answer F1', Value: summary.mean_answer_f1 },
      { Metric: 'Mean Semantic Similarity', Value: summary.mean_semantic_similarity },
      { Metric: 'Mean Fact Recall', Value: summary.mean_fact_recall },
      { Metric: 'Mean Fact Precision', Value: summary.mean_fact_precision },
      { Metric: 'Mean Answer Quality', Value: summary.mean_answer_quality },
      { Metric: 'Answer Exact Match Rate', Value: summary.answer_exact_match_rate },
      { Metric: 'Mean Retrieval Recall (File)', Value: summary.mean_file_recall },
      { Metric: 'Mean Retrieval Precision (File)', Value: summary.mean_file_precision },
      { Metric: 'Retrieval Exact Match Rate', Value: summary.retrieval_exact_match_rate },
    ];

    const toCellText = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object') return Array.isArray(value) ? value.map(toCellText).join(', ') : JSON.stringify(value);
      return JSON.stringify(value);
    };

    const detailHeaders = [
      'Query ID', 'Query', 'Expected Answer', 'Expected File', 'Expected Page',
      'Generated Answer', 'Retrieved Files', 'Retrieved Pages', 'Retrieved Sources',
      'Matched Sources', 'Retrieval Recall', 'Retrieval Precision', 'Retrieval Page Hit',
      'Retrieval Exact Match', 'Answer Recall', 'Answer Precision', 'Answer F1',
      'Semantic Similarity', 'Fact Recall', 'Fact Precision', 'Answer Quality',
      'Answer Exact Match', 'Judge Score', 'Judge Faithfulness', 'Judge Reasoning',
      'Status', 'Duration (ms)', 'Target Duration (ms)', 'Judge Duration (ms)', 'Error',
      'Execution Logs / Tool Calls', 'Token Usage',
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
        'Retrieved Pages': toCellText(ret.retrieved_pages),
        'Retrieved Sources': toCellText(ret.retrieved_sources),
        'Matched Sources': toCellText(ret.matched_sources),
        'Retrieval Recall': ret.file_recall,
        'Retrieval Precision': ret.file_precision,
        'Retrieval Page Hit': ret.page_hit,
        'Retrieval Exact Match': ret.exact_match,
        'Answer Recall': ans.token_recall,
        'Answer Precision': ans.token_precision,
        'Answer F1': ans.f1,
        'Semantic Similarity': ans.semantic_similarity,
        'Fact Recall': ans.fact_recall,
        'Fact Precision': ans.fact_precision,
        'Answer Quality': ans.answer_quality,
        'Answer Exact Match': ans.exact_match,
        'Judge Score': r.judge_score ?? '',
        'Judge Faithfulness': r.judge_faithfulness_score ?? '',
        'Judge Reasoning': r.judge_reasoning ?? '',
        'Status': r.status,
        'Duration (ms)': r.duration_ms,
        'Target Duration (ms)': r.target_duration_ms ?? '',
        'Judge Duration (ms)': r.judge_duration_ms ?? '',
        'Error': r.error ?? '',
        'Execution Logs / Tool Calls': toolCallsText,
        'Token Usage': tokenUsageText,
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

    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const logsJson = JSON.stringify(buildExecutionLogsExport(evaluationId, results), null, 2);
    const buffer = buildExportArchive({ evaluationId, xlsx: xlsxBuffer, logsJson });
    return { buffer, filename: buildExportFilename() };
  }
}
