import { eq, inArray } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import {
  FlowReplayValidationMode,
  FlowReplayValidationStatus,
} from '../interfaces/playbook-flow-validated-replay.interface';
import type { FlowReplayPostRunEvaluation } from '../interfaces/playbook-flow-replay-run-report.interface';
import {
  ValidatedReplayRepository,
  toValidatedReplayJson,
  type NewValidatedReplay,
} from './validated-replay.repository';
import { ReplayRunReportRepository, toReplayRunReportJson, type NewReplayRunReport } from './replay-run-report.repository';
import { EvaluationBaselineRepository } from './evaluation-baseline.repository';
import { EvaluationExecutionRepository } from './evaluation-execution.repository';

describeIntegration('replay and evaluation repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const replays = new ValidatedReplayRepository(db as never);
  const reports = new ReplayRunReportRepository(db as never);
  const baselines = new EvaluationBaselineRepository(db as never);
  const evaluations = new EvaluationExecutionRepository(db as never);

  const ownerId = oid();
  const flowId = oid();
  const otherFlowId = oid();
  const goneFlowId = oid(); // never inserted

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `pbd-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    for (const id of [flowId, otherFlowId]) {
      await db.insert(schema.playbookFlows).values({ id, ownerId, name: `replay flow ${id}` });
    }
  });

  afterAll(async () => {
    // The flows cascade to their replays, reports, baselines and evaluations.
    await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.ownerId, ownerId));
    await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, ownerId));
    await close();
  });

  const newReplay = (over: Partial<NewValidatedReplay> = {}): NewValidatedReplay => ({
    flowId,
    taskId: `task-${oid()}`,
    iteration: 0,
    taskTitle: 'Summarise',
    createdBy: ownerId,
    referenceExecutionId: oid(), // soft reference: no such run
    referenceExecutionNumber: 1,
    ...over,
  });

  describe('validated replays', () => {
    it('allocates versions per task, keeps the newest active and stores the template body with the schema defaults', async () => {
      const taskId = `task-${oid()}`;
      const first = await replays.createNextVersion(newReplay({
        taskId,
        mode: FlowReplayValidationMode.FLEX,
        taskTitle: 'Sum\u0000marise',
        toolCalls: [{ callIndex: 0, toolName: 'search', purpose: 'find', args: { q: 'x\u0000y' }, outputSummary: 'ok', status: 'completed' }],
        referenceOutput: 'first',
        intentLabel: 'Summaries',
      }));
      expect(first).toMatchObject({
        flowId,
        taskId,
        validationVersion: 1,
        status: FlowReplayValidationStatus.ACTIVE,
        mode: 'replay_flex',
        isStale: false,
        taskTitle: 'Summarise',
        referenceOutput: 'first',
        intentLabel: 'Summaries',
        reasoningOutline: [],
        formatGuideStatus: 'disabled',
        replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
      });
      // The FlowReplayToolCall cast: its keys and defaults only (a tool trace item's `purpose` is dropped).
      expect(first.toolCalls).toEqual([{ callIndex: 0, toolName: 'search', args: { q: 'xy' }, outputSummary: 'ok', status: 'completed', durationMs: null, error: null }]);
      expect(first).not.toHaveProperty('label');

      const second = await replays.createNextVersion(newReplay({ taskId, iteration: 1 }));
      const third = await replays.createNextVersion(newReplay({ taskId }));
      expect([second.validationVersion, third.validationVersion]).toEqual([2, 3]);

      const listed = await replays.listByTask(flowId, taskId);
      expect(listed.map((replay) => [replay.validationVersion, replay.status])).toEqual([[3, 'active'], [2, 'inactive'], [1, 'inactive']]);
      expect(await replays.listByTask(otherFlowId, taskId)).toEqual([]);
      expect(await replays.listByTask('not-an-id', taskId)).toEqual([]);
    });

    it('never draws the same version twice under concurrent validations', async () => {
      const taskId = `task-${oid()}`;
      const created = await Promise.all(Array.from({ length: 5 }, () => replays.createNextVersion(newReplay({ taskId }))));
      expect(created.map((replay) => replay.validationVersion).sort()).toEqual([1, 2, 3, 4, 5]);
      const listed = await replays.listByTask(flowId, taskId);
      expect(listed.filter((replay) => replay.status === 'active').map((replay) => replay.validationVersion)).toEqual([5]);
    });

    it('enforces one row per (flow, task, iteration, version) and cascades with the flow', async () => {
      const replay = await replays.createNextVersion(newReplay());
      const duplicate = db.insert(schema.playbookValidatedReplays).values({
        id: oid(), flowId, taskId: replay.taskId, iteration: 0, taskTitle: 't', createdBy: ownerId, referenceExecutionId: 'x', referenceExecutionNumber: 1, validationVersion: 1,
      });
      await expect(duplicate).rejects.toMatchObject({ cause: expect.objectContaining({ constraint: 'uq_playbook_validated_replays_version' }) });
      await expect(replays.createNextVersion(newReplay({ flowId: goneFlowId }))).rejects.toThrow();
    });

    it('reads a baseline by task, identity and active status, and guards malformed ids', async () => {
      const taskId = `task-${oid()}`;
      const v1 = await replays.createNextVersion(newReplay({ taskId }));
      const v2 = await replays.createNextVersion(newReplay({ taskId }));

      expect((await replays.findInTask(v1.id, flowId, taskId))?.validationVersion).toBe(1);
      expect(await replays.findInTask(v1.id, flowId, 'another-task')).toBeNull();
      expect(await replays.findInTask(v1.id, otherFlowId, taskId)).toBeNull();
      expect(await replays.findInTask('nope', flowId, taskId)).toBeNull();
      expect((await replays.findInTask(v1.id.toUpperCase(), flowId.toUpperCase(), taskId))?.id).toBe(v1.id);

      expect((await replays.findByIdentity({ id: v1.id, flowId, taskId, validationVersion: 1 }))?.status).toBe('inactive');
      expect(await replays.findByIdentity({ id: v1.id, flowId, taskId, validationVersion: 2 })).toBeNull();

      expect((await replays.findActive(flowId, taskId))?.id).toBe(v2.id);
      const other = await replays.createNextVersion(newReplay());
      const active = await replays.listActiveForTasks(flowId, [taskId, other.taskId, 'unknown']);
      expect(active.map((replay) => replay.id)).toEqual([v2.id, other.id]);
      expect(await replays.listActiveForTasks(flowId, [])).toEqual([]);
    });

    it('activates one baseline of the task in one statement, and changes nothing for a foreign id', async () => {
      const taskId = `task-${oid()}`;
      const v1 = await replays.createNextVersion(newReplay({ taskId }));
      const v2 = await replays.createNextVersion(newReplay({ taskId }));
      const elsewhere = await replays.createNextVersion(newReplay());

      expect(await replays.activate(elsewhere.id, flowId, taskId)).toBeNull();
      expect(await replays.activate(oid(), flowId, taskId)).toBeNull();
      expect(await replays.activate('bad', flowId, taskId)).toBeNull();
      expect((await replays.findActive(flowId, taskId))?.id).toBe(v2.id);

      const activated = await replays.activate(v1.id, flowId, taskId);
      expect(activated).toMatchObject({ id: v1.id, status: 'active' });
      expect(activated!.updatedAt.getTime()).toBeGreaterThanOrEqual(v1.updatedAt.getTime());
      const listed = await replays.listByTask(flowId, taskId);
      expect(listed.map((replay) => [replay.validationVersion, replay.status])).toEqual([[2, 'inactive'], [1, 'active']]);
      expect((await replays.findActive(flowId, elsewhere.taskId))?.id).toBe(elsewhere.id);
    });

    it('overwrites top-level fields, merges replayConfig and sets or clears the label', async () => {
      const replay = await replays.createNextVersion(newReplay({
        outputFormatGuide: 'old',
        fingerprints: { inputContextHash: 'a', outputContractHash: 'x' },
        replayConfig: { replayOutputFormat: true, replayToolTrace: true, replayReasoningChain: false },
      }));

      const updated = await replays.update(replay.id, flowId, replay.taskId, {
        outputFormatGuide: null,
        preserveOutputFormat: true,
        fingerprints: { outputContractHash: 'y' },
        replayConfig: { replayToolTrace: false },
        label: 'Golden',
        unknownField: 'dropped',
      } as never);
      expect(updated).toMatchObject({
        outputFormatGuide: null,
        preserveOutputFormat: true,
        fingerprints: { outputContractHash: 'y' },
        replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: false },
        label: 'Golden',
        referenceWorkspaceIds: [],
      });
      expect(updated).not.toHaveProperty('unknownField');
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(replay.updatedAt.getTime() - 1);

      const cleared = await replays.update(replay.id, flowId, replay.taskId, { label: null });
      expect(cleared).not.toHaveProperty('label');
      expect(await replays.update(replay.id, otherFlowId, replay.taskId, { label: 'x' })).toBeNull();
    });

    it('merges a replayConfig key into the defaults when a legacy document has none', async () => {
      const id = oid();
      const taskId = `task-${oid()}`;
      await db.insert(schema.playbookValidatedReplays).values({
        id, flowId, taskId, iteration: 0, taskTitle: 'legacy', createdBy: ownerId, referenceExecutionId: 'gone', referenceExecutionNumber: 1,
        validationVersion: 1, mode: 'strict_replay', doc: { referenceOutput: 'legacy output', toolCalls: [] },
      });

      const legacy = await replays.findInTask(id, flowId, taskId);
      // A lean read: what the legacy document stored, nothing more.
      expect(legacy).toMatchObject({ mode: 'strict_replay', referenceOutput: 'legacy output' });
      expect(legacy).not.toHaveProperty('replayConfig');
      expect(legacy).not.toHaveProperty('intentLabel');
      // The hydrated JSON view: defaults and the serialised mode.
      expect(toValidatedReplayJson(legacy!)).toMatchObject({ mode: 'replay_strict', intentLabel: '', staleReasons: [], replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true } });

      const updated = await replays.update(id, flowId, taskId, { replayConfig: { replayOutputFormat: true } });
      expect(updated?.replayConfig).toEqual({ replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: true });
    });

    it('deletes one of the task\'s baselines and reports the status it had', async () => {
      const replay = await replays.createNextVersion(newReplay());
      expect(await replays.deleteInTask(replay.id, flowId, 'another-task')).toBeNull();
      expect(await replays.deleteInTask(replay.id, flowId, replay.taskId)).toEqual({ status: 'active' });
      expect(await replays.deleteInTask(replay.id, flowId, replay.taskId)).toBeNull();
    });
  });

  describe('replay run reports', () => {
    const newReport = (over: Partial<NewReplayRunReport> = {}): NewReplayRunReport => ({
      executionId: oid(), // soft reference
      flowId,
      taskId: 'step-1',
      replayId: oid(),
      validationVersion: 1,
      mode: 'replay_flex',
      ...over,
    });

    it('creates a report with the schema defaults, dropping unknown fields', async () => {
      const report = await reports.create(newReport({
        verdict: 'unknown',
        verdictReasons: ['evaluation_pending'],
        hitlSummary: { baselineHitlCount: 1, runtimeHitlCount: 0, reusedMemoryCount: 0, newClarificationCount: 0, approvalReaskedCount: 0, hitlContextDrift: true, findings: [] },
        semanticMatch: { reason: 'a\u0000b' } as never,
        applied: true,
      } as never));
      expect(report).toMatchObject({
        iteration: 0,
        verdict: 'unknown',
        overallScore: null,
        verdictReasons: ['evaluation_pending'],
        outputContractEvaluated: false,
        driftFindings: [],
        intentStatus: { status: 'not_evaluated', reason: 'evaluation_pending' },
        postRunEvaluation: null,
        hitlSummary: expect.objectContaining({ baselineHitlCount: 1 }),
        semanticMatch: { reason: 'ab' },
      });
      expect(report).not.toHaveProperty('applied');
      expect(await reports.findById(report.id)).toEqual(report);
      expect(await reports.findById('nope')).toBeNull();
      await expect(reports.create(newReport({ verdict: 'skipped' as never }))).rejects.toThrow();
      await expect(reports.create(newReport({ flowId: goneFlowId }))).rejects.toThrow();
    });

    it('finds the newest report for an execution task, narrowed by iteration, replay or version', async () => {
      const executionId = oid();
      const replayId = oid();
      const older = await reports.create(newReport({ executionId, replayId, iteration: 0 }));
      const newer = await reports.create(newReport({ executionId, replayId, iteration: 1, validationVersion: 2 }));

      expect((await reports.findLatest({ executionId, taskId: 'step-1' }))?.id).toBe(newer.id);
      expect((await reports.findLatest({ executionId, taskId: 'step-1', iteration: 0 }))?.id).toBe(older.id);
      expect((await reports.findLatest({ executionId, taskId: 'step-1', replayId, validationVersion: 1 }))?.id).toBe(older.id);
      expect(await reports.findLatest({ executionId, taskId: 'step-1', replayId: oid() })).toBeNull();
      expect(await reports.findLatest({ executionId: executionId.toUpperCase(), taskId: 'step-2' })).toBeNull();
    });

    it('lists a task\'s reports newest first, paged and filtered', async () => {
      const taskId = `list-${oid()}`;
      const executionId = oid();
      const created = [];
      for (let i = 0; i < 3; i++) created.push(await reports.create(newReport({ taskId, executionId: i === 2 ? oid() : executionId, iteration: i })));

      const all = await reports.list({ flowId, taskId, offset: 0, limit: 10 });
      expect(all.map((report) => report.id)).toEqual([created[2].id, created[1].id, created[0].id]);
      expect((await reports.list({ flowId, taskId, offset: 1, limit: 1 })).map((report) => report.id)).toEqual([created[1].id]);
      expect((await reports.list({ flowId, taskId, executionId, offset: 0, limit: 10 })).map((report) => report.id)).toEqual([created[1].id, created[0].id]);
      expect((await reports.list({ flowId, taskId, iteration: 0, offset: 0, limit: 10 })).map((report) => report.id)).toEqual([created[0].id]);
      expect(await reports.list({ flowId: 'nope', taskId, offset: 0, limit: 10 })).toEqual([]);
    });

    it('reads each replay\'s newest score, leaving out a replay whose newest report has none', async () => {
      const scored = oid();
      const unscored = oid();
      await reports.create(newReport({ replayId: scored, overallScore: 40 }));
      await reports.create(newReport({ replayId: scored, overallScore: 91.5 }));
      await reports.create(newReport({ replayId: unscored, overallScore: 70 }));
      await reports.create(newReport({ replayId: unscored }));

      const scores = await reports.latestScoresForReplays([scored, unscored, oid()]);
      expect([...scores.entries()]).toEqual([[scored, 91.5]]);
      expect(await reports.latestScoresForReplays([])).toEqual(new Map());
    });

    it('writes promoted columns and merges the other fields into the document', async () => {
      const report = await reports.create(newReport({ driftFindings: [{ category: 'tool', severity: 'warning', reason: 'x' }] }));
      expect(await reports.update(report.id, { verdict: 'pass', overallScore: 88, verdictReasons: [], semanticStatus: { status: 'passed', reason: null } })).toBe(true);

      const updated = await reports.findById(report.id);
      expect(updated).toMatchObject({ verdict: 'pass', overallScore: 88, verdictReasons: [], semanticStatus: { status: 'passed', reason: null }, driftFindings: [{ category: 'tool', severity: 'warning', reason: 'x' }] });
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(report.updatedAt.getTime());
      expect(await reports.update(oid(), { verdict: 'fail' })).toBe(false);
      expect(await reports.update('bad', { verdict: 'fail' })).toBe(false);
    });

    it('keeps the first post-run evaluation when several finish at once', async () => {
      const report = await reports.create(newReport());
      const evaluation = (summary: string): FlowReplayPostRunEvaluation => ({
        judgeUsed: false, judgeModel: null, evaluatedAt: new Date('2026-09-25T10:00:00.000Z'), verdict: 'not_comparable', overallScore: null, semanticMatchScore: null,
        outputFormatScore: null, toolSequenceScore: null, toolDefinitionScore: null, reasoningScore: null, summary, missingPoints: [], changedPoints: [], preservedPoints: [],
        recommendedAction: 'review', rawJudgeResponse: null, failureReason: 'x',
      });

      const outcomes = await Promise.all(['a', 'b', 'c', 'd'].map((summary) => reports.setPostRunEvaluationIfAbsent(report.id, evaluation(summary))));
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const stored = await reports.findById(report.id);
      expect(stored?.postRunEvaluation?.evaluatedAt).toEqual(new Date('2026-09-25T10:00:00.000Z'));
      expect(['a', 'b', 'c', 'd']).toContain(stored?.postRunEvaluation?.summary);
      expect(await reports.setPostRunEvaluationIfAbsent(report.id, evaluation('late'))).toBe(false);
    });

    it('reads a legacy report as stored and fills the defaults only in the JSON view', async () => {
      const id = oid();
      await db.insert(schema.playbookReplayRunReports).values({
        id, executionId: 'gone', flowId, taskId: 'legacy', iteration: 0, replayId: 'r', validationVersion: 1, mode: 'replay_flex', verdict: 'unknown',
        doc: { applied: false, confidenceScore: 45 },
      });
      const legacy = await reports.findById(id);
      expect(legacy).toMatchObject({ applied: false, confidenceScore: 45 });
      expect(legacy).not.toHaveProperty('driftFindings');
      expect(toReplayRunReportJson(legacy!)).toMatchObject({ driftFindings: [], intentStatus: { status: 'not_evaluated', reason: 'evaluation_pending' }, applied: false });
    });
  });

  describe('evaluation baselines', () => {
    it('replaces the task\'s active baselines (any iteration) and reads the newest active one', async () => {
      const taskId = `task-${oid()}`;
      const first = await baselines.replaceActive({ flowId, taskId, iteration: 0, sourceExecutionId: oid(), sourceMode: 'selected_execution', createdByUserId: ownerId });
      const second = await baselines.replaceActive({ flowId, taskId, iteration: 1, sourceExecutionId: oid(), sourceMode: 'current_inputs', createdByUserId: ownerId, inputSnapshots: [{ sourceTaskId: 'a', artifacts: [] }] });
      expect(first).toMatchObject({ taskId, iteration: 0, replacedAt: null, inputSnapshots: [] });
      expect(second).toMatchObject({ iteration: 1, sourceMode: 'current_inputs', inputSnapshots: [{ sourceTaskId: 'a', artifacts: [] }] });

      expect((await baselines.findActive(flowId, taskId))?.id).toBe(second!.id);
      expect((await baselines.findActive(flowId, taskId, 1))?.id).toBe(second!.id);
      expect(await baselines.findActive(flowId, taskId, 0)).toBeNull();
      expect((await baselines.findActive(flowId, taskId, '1' as unknown as number))?.id).toBe(second!.id);
      expect(await baselines.findActive(flowId, taskId, 'x' as unknown as number)).toBeNull();

      const rows = await db.select().from(schema.playbookEvaluationBaselines).where(eq(schema.playbookEvaluationBaselines.taskId, taskId));
      expect(rows.find((row) => row.id === first!.id)?.replacedAt).toBeInstanceOf(Date);

      expect(await baselines.retireActive(flowId, taskId)).toBe(1);
      expect(await baselines.findActive(flowId, taskId)).toBeNull();
      expect(await baselines.retireActive(flowId, taskId)).toBe(0);
    });

    it('leaves a single active baseline when replacements race', async () => {
      const taskId = `task-${oid()}`;
      await Promise.all(Array.from({ length: 4 }, (_, i) => baselines.replaceActive({ flowId, taskId, iteration: i, sourceExecutionId: oid(), sourceMode: 'selected_execution', createdByUserId: ownerId })));
      const rows = await db.select().from(schema.playbookEvaluationBaselines).where(eq(schema.playbookEvaluationBaselines.taskId, taskId));
      expect(rows).toHaveLength(4);
      expect(rows.filter((row) => row.replacedAt === null)).toHaveLength(1);
    });

    it('refuses a baseline for a flow that does not exist, retiring nothing', async () => {
      const taskId = `task-${oid()}`;
      await baselines.replaceActive({ flowId, taskId, iteration: 0, sourceExecutionId: oid(), sourceMode: 'selected_execution', createdByUserId: ownerId });
      expect(await baselines.replaceActive({ flowId: goneFlowId, taskId, iteration: 0, sourceExecutionId: oid(), sourceMode: 'selected_execution', createdByUserId: ownerId })).toBeNull();
      expect(await baselines.replaceActive({ flowId: 'nope', taskId, iteration: 0, sourceExecutionId: oid(), sourceMode: 'selected_execution', createdByUserId: ownerId })).toBeNull();
      expect(await baselines.findActive(flowId, taskId)).not.toBeNull();
    });
  });

  describe('evaluation executions', () => {
    it('records an evaluation with the Mongoose defaults and leaves unset fields out', async () => {
      const executionId = oid();
      const record = await evaluations.create({ flowId, executionId, taskId: 'eval-1', iteration: 0, taskTitle: 'Check', mode: 'hybrid', status: 'completed', score: 72, findings: [{ severity: 'warning', category: 'format', message: 'm' }] });
      expect(record).toMatchObject({
        executionId,
        mode: 'hybrid',
        status: 'completed',
        score: 72,
        expectation: '',
        rubricVersion: 'evaluation-node-v1',
        findings: [{ severity: 'warning', category: 'format', message: 'm' }],
        metrics: { connectedInputCount: 0, artifactCount: 0, completedUpstreamSteps: 0, failedUpstreamSteps: 0 },
        startedAt: expect.any(Date),
      });
      for (const unset of ['verdict', 'semanticScore', 'summary', 'judgeModel', 'completedAt', 'error', 'baselineId']) {
        expect(record).not.toHaveProperty(unset);
      }
      expect(await evaluations.create({ flowId: goneFlowId, executionId, taskId: 'eval-1', iteration: 0, taskTitle: 'Check', mode: 'hybrid', status: 'completed' })).toBeNull();
      await expect(evaluations.create({ flowId, executionId, taskId: 'eval-1', iteration: 0, taskTitle: 'Check', mode: 'judge', status: 'completed' })).rejects.toThrow();
    });

    it('lists a flow\'s evaluations newest first, a run\'s by iteration, and a task\'s newest', async () => {
      const executionId = oid();
      const taskId = `eval-${oid()}`;
      const a = await evaluations.create({ flowId: otherFlowId, executionId, taskId, iteration: 1, taskTitle: 'A', mode: 'semantic', status: 'completed' });
      const b = await evaluations.create({ flowId: otherFlowId, executionId, taskId, iteration: 0, taskTitle: 'B', mode: 'semantic', status: 'failed' });
      const c = await evaluations.create({ flowId: otherFlowId, executionId: oid(), taskId: 'other', iteration: 0, taskTitle: 'C', mode: 'reference', status: 'running' });

      expect((await evaluations.listByFlow(otherFlowId, { limit: 50 })).map((row) => row.id)).toEqual([c!.id, b!.id, a!.id]);
      expect((await evaluations.listByFlow(otherFlowId, { taskId, limit: 1 })).map((row) => row.id)).toEqual([b!.id]);
      expect((await evaluations.listForExecution(otherFlowId, executionId)).map((row) => row.iteration)).toEqual([0, 1]);
      expect((await evaluations.findLatestForTask(executionId, taskId))?.id).toBe(b!.id);
      expect(await evaluations.findLatestForTask(executionId, 'nothing')).toBeNull();
      expect(await evaluations.listByFlow('nope', { limit: 5 })).toEqual([]);
    });
  });

  it('removes everything under a deleted flow', async () => {
    const doomedFlowId = oid();
    await db.insert(schema.playbookFlows).values({ id: doomedFlowId, ownerId, name: `doomed ${doomedFlowId}` });
    const replay = await replays.createNextVersion(newReplay({ flowId: doomedFlowId }));
    const report = await reports.create({ executionId: oid(), flowId: doomedFlowId, taskId: 't', replayId: replay.id, validationVersion: 1, mode: 'replay_strict' });
    await baselines.replaceActive({ flowId: doomedFlowId, taskId: 't', iteration: 0, sourceExecutionId: oid(), sourceMode: 'selected_execution', createdByUserId: ownerId });
    await evaluations.create({ flowId: doomedFlowId, executionId: oid(), taskId: 't', iteration: 0, taskTitle: 'T', mode: 'hybrid', status: 'completed' });

    await db.delete(schema.playbookFlows).where(inArray(schema.playbookFlows.id, [doomedFlowId]));

    expect(await replays.findInTask(replay.id, doomedFlowId, replay.taskId)).toBeNull();
    expect(await reports.findById(report.id)).toBeNull();
    expect(await baselines.findActive(doomedFlowId, 't')).toBeNull();
    expect(await evaluations.listByFlow(doomedFlowId, { limit: 5 })).toEqual([]);
  });
});
