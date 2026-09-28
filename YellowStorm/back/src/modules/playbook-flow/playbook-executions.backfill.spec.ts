import { eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { isUniqueViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import * as u from '../../../scripts/migrate/2026-10-playbook-executions.units';
import type { Row } from '../../../scripts/migrate/2026-10-playbook-executions.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { ExecutionRepository } from './persistence/execution.repository';
import { TaskResultRepository } from './persistence/task-result.repository';
import { RouterDecisionRepository } from './persistence/router-decision.repository';

/**
 * Drives the runs backfill mapping, validation and insert with fabricated Mongo-shaped documents
 * (string-typed and upper-cased ids, runs of deleted flows, missing modes, NUL in model output, a
 * JSON-looking text output) and checks every migrated row reads back identical — the task-result
 * documents through their sha256, exactly as the runner's checksum does — then that the repositories
 * serve them like rows the services wrote.
 */
describeIntegration('playbook runs backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const oid = (): string => newObjectId();
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);
  const at = (iso: string): Date => new Date(iso);
  const executions = new ExecutionRepository(db as never);
  const taskResults = new TaskResultRepository(db as never);
  const routerDecisions = new RouterDecisionRepository(db as never);

  const ownerId = oid();
  const flowId = oid();
  const goneFlowId = oid(); // never inserted
  const goneUserId = oid(); // never inserted
  const executionId = oid(); // migrated by the first test, parent of the task results
  const goneExecutionId = oid(); // never inserted

  const refs = (over: Partial<Record<keyof u.ExecutionRefs, string[]>> = {}): u.ExecutionRefs => ({
    users: new Set(over.users ?? [ownerId]),
    flows: new Set(over.flows ?? [flowId]),
    executions: new Set(over.executions ?? [executionId]),
  });

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `pbrun-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    await db.insert(schema.playbookFlows).values({ id: flowId, ownerId, name: `flow ${flowId}` });
  });

  afterAll(async () => {
    // The flow cascades to its runs, and the runs to their task results and router decisions.
    await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.id, flowId));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId]));
    await close();
  });

  const executionDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: objectId(executionId),
    flowId: flowId.toUpperCase(),
    ownerId,
    schemaVersion: 1,
    status: 'pending_approval',
    startedAt: at('2026-03-01T09:00:00Z'),
    recursionLimit: 25,
    maxParallelism: 5,
    playbookExecutionSettings: { maxConcurrentPerUser: 3, dynamicReasoningEnabled: false },
    playbookPlannerSnapshot: { agentId: 'planner', model: 'm', promptHash: 'sha256:x' },
    inputContext: { brief: 'Quarterly\u0000 report', nested: { list: [1, 2, 3] } },
    snapshot: { name: 'Flow', nodes: [{ id: 'step-1', kind: 'step', metadata: { enabled: true } }], controlEdges: [], dataBindings: [], settings: {} },
    idempotencyKey: 'idem-1',
    pendingApproval: { nodeId: 'step-1', iteration: 0, prompt: 'Approve?', requestedAt: at('2026-03-01T09:05:00Z'), interruptId: 'i-1', resumableActions: ['approve', 'reject'] },
    hitlEvents: [{
      id: 'h-1', nodeId: 'step-1', iteration: 0, interruptId: 'i-1', type: 'approval_request', blockerRuleId: null, blockerKind: null,
      reasonCode: 'runtime_interrupt', riskLevel: 'medium', prompt: 'Approve?', payload: {}, status: 'pending', response: null,
      downstreamNodeIds: [], createdAt: at('2026-03-01T09:05:00Z'), respondedAt: null,
    }],
    queuePosition: 0,
    singleStepTaskId: 'step-1',
    advisorAutopilotEnabled: false,
    reflectionEnabled: true,
    advisorScoringMode: null,
    seededTaskOutputs: [{ nodeId: 'step-0', iteration: 0, payload: { output: 'seed' } }],
    executionMode: null,
    stepExecutionModes: { 'step-1': 'replay_flex' },
    replayPlanningByTask: {},
    replaySource: { executionId: oid(), taskId: 'step-1', iteration: 0 },
    createdAt: at('2026-03-01T08:59:00Z'),
    updatedAt: at('2026-03-01T09:05:00Z'),
    __v: 0,
    ...over,
  });

  const readBack = async (table: string, select: string, id: unknown): Promise<Row> => {
    const back = await pool.query(`SELECT ${select} FROM ${table} WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const sameContent = (row: Row, back: Row): void => {
    expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 });
  };

  describe('executions', () => {
    it('maps a paused run with its documents, defaults the missing modes and reads back identical', async () => {
      const row = u.buildExecution(executionDoc());

      expect(row).toMatchObject({
        id: executionId,
        flow_id: flowId,
        owner_id: ownerId,
        status: 'pending_approval',
        execution_mode: 'live',
        advisor_scoring_mode: 'llm',
        input_context: { brief: 'Quarterly report', nested: { list: [1, 2, 3] } },
        planner_snapshot: { agentId: 'planner', model: 'm', promptHash: 'sha256:x' },
        pending_approval: { nodeId: 'step-1', requestedAt: '2026-03-01T09:05:00.000Z' },
        hitl_events: [{ id: 'h-1', createdAt: '2026-03-01T09:05:00.000Z', respondedAt: null }],
        ended_at: null,
        thread_id: null,
        model_id_override: null,
      });
      expect(u.validateExecution(row, refs())).toBeNull();
      await u.insertExecution(pool, row);
      sameContent(row, await readBack(u.EXECUTION_TABLE, u.EXECUTION_COLUMNS.join(', '), row.id));

      const served = await executions.findById(executionId, { withSnapshot: true, withPlannerSnapshot: true });
      expect(served).toMatchObject({
        status: 'pending_approval', flowId, executionMode: 'live', advisorScoringMode: 'llm', reflectionEnabled: true,
        stepExecutionModes: { 'step-1': 'replay_flex' }, seededTaskOutputs: [{ nodeId: 'step-0', iteration: 0 }],
        snapshot: { name: 'Flow' }, plannerSnapshot: { agentId: 'planner' },
      });
      expect(served?.pendingApproval?.requestedAt).toEqual(at('2026-03-01T09:05:00Z'));
      expect(served?.hitlEvents[0].createdAt).toEqual(at('2026-03-01T09:05:00Z'));
      expect(await executions.isInterruptStale(executionId, 'i-1')).toBe(false);
      expect((await executions.listActive(ownerId)).map((run) => run.id)).toContain(executionId);
    });

    it('maps a minimal legacy run: absent arrays and documents as the column defaults', async () => {
      const id = oid();
      const row = u.buildExecution({
        _id: objectId(id), flowId, ownerId, status: 'completed', recursionLimit: 25, maxParallelism: 5, queuePosition: 0,
        createdAt: at('2026-01-01T00:00:00Z'), updatedAt: at('2026-01-01T00:01:00Z'),
      });

      expect(row).toMatchObject({
        hitl_events: [], seeded_task_outputs: [], step_execution_modes: {}, replay_planning_by_task: {}, pending_approval: null, snapshot: null,
        advisor_autopilot_enabled: false, reflection_enabled: false, execution_mode: 'live', advisor_scoring_mode: 'llm', schema_version: 1,
      });
      await u.insertExecution(pool, row);
      sameContent(row, await readBack(u.EXECUTION_TABLE, u.EXECUTION_COLUMNS.join(', '), id));
    });

    it('reports a run of a deleted flow or a gone user instead of inserting it', () => {
      const orphan = u.buildExecution(executionDoc({ _id: objectId(oid()), flowId: goneFlowId }));
      expect(u.validateExecution(orphan, refs())).toBe(`dangling flow_id ${goneFlowId} (flow deleted without its runs; FK would reject)`);
      const lost = u.buildExecution(executionDoc({ _id: objectId(oid()), ownerId: goneUserId }));
      expect(u.validateExecution(lost, refs())).toBe(`dangling owner_id ${goneUserId} (user gone from PG; FK would reject)`);
    });

    it('rejects what the table cannot hold', () => {
      expect(u.validateExecution(u.buildExecution(executionDoc({ status: 'paused' })), refs())).toMatch(/status 'paused'/);
      expect(u.validateExecution(u.buildExecution(executionDoc({ executionMode: 'strict_replay' })), refs())).toMatch(/execution_mode 'strict_replay'/);
      expect(() => u.buildExecution(executionDoc({ flowId: 'not-a-flow' }))).toThrow(BackfillError);
      expect(() => u.buildExecution(executionDoc({ ownerId: undefined }))).toThrow(BackfillError);
    });
  });

  describe('task results', () => {
    const taskDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: objectId(oid()),
      executionId: executionId.toUpperCase(),
      taskId: `step-${oid()}`,
      iteration: 0,
      status: 'completed',
      output: '{"verdict":"ok"}',
      displayText: 'Verdict: ok\u0000',
      outputs: { default: { output_port_id: 'default', artifact_kind: 'text', content: 'ok' } },
      artifacts: [{ port_id: 'default', artifact_kind: 'text', content: 'ok' }],
      components: [{ type: 'text', data: { content: 'ok' } }],
      error: null,
      startedAt: at('2026-03-01T09:01:00Z'),
      endedAt: at('2026-03-01T09:02:00Z'),
      toolTrace: [{ callIndex: 0, toolName: 'search', purpose: null, args: { q: 'x' }, outputSummary: 'found\u0000', status: 'completed', durationMs: 12, error: null }],
      reasoningChain: [{ id: 'r1', type: 'observation', label: 'L', description: 'D', confidence: null }],
      llmPromptTrace: [{ stage: 'initial_request', model: 'm', prompt: 'p', generatedOutput: 'g' }],
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, model: 'm' },
      semanticMatch: null,
      traceMetadata: { observed_intent_key: 'k' },
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 82.5, rewriteHints: ['shorter'] },
      judgeScoringMode: 'llm',
      judgeError: null,
      judgeHistory: [{ id: 'j1', createdAt: at('2026-03-01T09:03:00Z'), attemptNumber: 1, scoringMode: 'llm', judgeResult: { overallScore: 82.5 } }],
      createdAt: at('2026-03-01T09:01:00Z'),
      updatedAt: at('2026-03-01T09:03:00Z'),
      __v: 0,
      ...over,
    });
    const checksumBack = async (id: unknown): Promise<Row> =>
      u.taskResultChecksumRow(await readBack(u.TASK_RESULT_TABLE, u.TASK_RESULT_CHECKSUM_SELECT, id));

    it('maps a completed result, carries its documents beside the unit and reads back identical', async () => {
      const source = taskDoc();
      const { row, heavy } = u.buildTaskResult(source);

      expect(row).toMatchObject({ execution_id: executionId, status: 'completed', judge_status: 'evaluated', content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(row).not.toHaveProperty('output');
      expect(heavy).toMatchObject({
        output: '{"verdict":"ok"}',
        display_text: 'Verdict: ok',
        tool_trace: [{ outputSummary: 'found' }],
        judge_history: [{ id: 'j1', createdAt: '2026-03-01T09:03:00.000Z' }],
      });
      expect(u.validateTaskResult(row, refs())).toBeNull();
      await u.insertTaskResult(pool, row, heavy);
      sameContent(row, await checksumBack(row.id));

      const served = await taskResults.find({ executionId, taskId: String(source.taskId), iteration: 0 });
      // A text output that happens to be JSON stays text.
      expect(served?.output).toBe('{"verdict":"ok"}');
      expect(served?.judgeHistory[0].createdAt).toEqual(at('2026-03-01T09:03:00Z'));
      expect(served).toMatchObject({ status: 'completed', displayText: 'Verdict: ok', usage: { totalTokens: 30 }, judgeScoringMode: 'llm' });
    });

    it('maps a sparse legacy result: the Mongoose defaults, an interrupted status and the id time as creation', async () => {
      const id = oid();
      const { row, heavy } = u.buildTaskResult({
        _id: objectId(id), executionId, taskId: 'step-x', iteration: 1, status: 'interrupted', startedAt: at('2026-03-01T09:00:00Z'), updatedAt: at('2026-03-01T09:00:00Z'),
      });

      expect(row).toMatchObject({ judge_status: 'idle', judge_scoring_mode: null, created_at: objectId(id).getTimestamp() });
      expect(heavy).toMatchObject({ output: null, outputs: null, artifacts: null, tool_trace: [], reasoning_chain: [], trace_metadata: {}, judge_history: [] });
      expect(u.validateTaskResult(row, refs())).toBeNull();
      await u.insertTaskResult(pool, row, heavy);
      sameContent(row, await checksumBack(id));
    });

    it('detects a document that differs through the checksum', async () => {
      const { row, heavy } = u.buildTaskResult(taskDoc());
      await u.insertTaskResult(pool, row, heavy);
      await pool.query(`UPDATE ${u.TASK_RESULT_TABLE} SET tool_trace = '[]'::jsonb WHERE id = $1`, [row.id]);
      expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), await checksumBack(row.id)]]))).toMatchObject({ match: false, mismatchTotal: 1 });
    });

    it('reports a result of a run that is gone, and what the table cannot hold', () => {
      const { row } = u.buildTaskResult(taskDoc({ executionId: goneExecutionId }));
      expect(u.validateTaskResult(row, refs())).toBe(`dangling execution_id ${goneExecutionId} (run gone from PG; FK would reject)`);
      expect(u.validateTaskResult(u.buildTaskResult(taskDoc({ status: 'paused' })).row, refs())).toMatch(/status 'paused'/);
      expect(u.validateTaskResult(u.buildTaskResult(taskDoc({ judgeScoringMode: 'vibes' })).row, refs())).toMatch(/judge_scoring_mode 'vibes'/);
      expect(u.validateTaskResult(u.buildTaskResult(taskDoc({ taskId: undefined })).row, refs())).toBe('task_id is empty');
      expect(() => u.buildTaskResult(taskDoc({ executionId: 'nope' }))).toThrow(BackfillError);
    });

    it('is idempotent, and records a second row for the same task and iteration as a failure', async () => {
      const source = taskDoc();
      const { row, heavy } = u.buildTaskResult(source);
      await u.insertTaskResult(pool, row, heavy);
      await u.insertTaskResult(pool, row, heavy);
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${u.TASK_RESULT_TABLE} WHERE id = $1`, [row.id])).rows[0].n).toBe(1);

      const twin = u.buildTaskResult({ ...source, _id: objectId(oid()) });
      const clash = await u.insertTaskResult(pool, twin.row, twin.heavy).catch((err: unknown) => err);
      expect(isUniqueViolation(clash, 'uq_playbook_task_results_task')).toBe(true);
    });
  });

  describe('router decisions', () => {
    it('maps a decision and reads it back identical', async () => {
      const id = oid();
      const row = u.buildRouterDecision({ _id: objectId(id), executionId, routerNodeId: 'router-1', iteration: 2, label: 'retry', decidedAt: at('2026-03-01T09:04:00Z'), __v: 0 });

      expect(row).toEqual({ id, execution_id: executionId, router_node_id: 'router-1', iteration: 2, label: 'retry', decided_at: at('2026-03-01T09:04:00Z') });
      expect(u.validateRouterDecision(row, refs())).toBeNull();
      await u.insertRouterDecision(pool, row);
      sameContent(row, await readBack(u.ROUTER_DECISION_TABLE, u.ROUTER_DECISION_COLUMNS.join(', '), id));
      expect((await routerDecisions.listForExecution(executionId)).map((decision) => decision.id)).toContain(id);
    });

    it('reports a decision of a run that is gone', () => {
      const row = u.buildRouterDecision({ _id: objectId(oid()), executionId: goneExecutionId, routerNodeId: 'r', iteration: 0, label: 'x', decidedAt: at('2026-03-01T00:00:00Z') });
      expect(u.validateRouterDecision(row, refs())).toBe(`dangling execution_id ${goneExecutionId} (run gone from PG; FK would reject)`);
    });
  });
});
