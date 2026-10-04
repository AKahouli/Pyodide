import { eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import * as u from '../../../scripts/migrate/2026-10-playbook-replays.units';
import type { PlaybookReplayRefs, Row } from '../../../scripts/migrate/2026-10-playbook-replays.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { ValidatedReplayRepository, toValidatedReplayJson } from './persistence/validated-replay.repository';
import { ReplayRunReportRepository } from './persistence/replay-run-report.repository';
import { EvaluationBaselineRepository } from './persistence/evaluation-baseline.repository';
import { EvaluationExecutionRepository } from './persistence/evaluation-execution.repository';

/**
 * Drives the replay / report / evaluation backfill mapping with fabricated Mongo-shaped documents (the
 * legacy `strict_replay` mode, the removed eligibility gate's fields and `skipped` verdict, BSON values
 * inside the template body, dangling runs and flows; the dev data has no evaluations at all) and checks
 * every migrated row reads back identical, exactly as the runner's checksum does, and reads through the
 * repositories as the services expect.
 */
describeIntegration('playbook replays backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const replays = new ValidatedReplayRepository(db as never);
  const reports = new ReplayRunReportRepository(db as never);
  const baselines = new EvaluationBaselineRepository(db as never);
  const evaluations = new EvaluationExecutionRepository(db as never);
  const oid = (): string => newObjectId();
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);
  const at = (iso: string): Date => new Date(iso);

  const ownerId = oid();
  const flowId = oid();
  const goneFlowId = oid(); // never inserted
  const goneExecutionId = oid(); // never inserted: soft references keep it

  const refs = (flows: string[] = [flowId]): PlaybookReplayRefs => ({ flows: new Set(flows) });
  const stamp = { createdAt: at('2026-03-01T09:00:00Z'), updatedAt: at('2026-03-01T09:30:00Z') };

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `pbd-bf-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    await db.insert(schema.playbookFlows).values({ id: flowId, ownerId, name: `replay backfill ${flowId}` });
  });

  afterAll(async () => {
    await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.id, flowId));
    await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, ownerId));
    await close();
  });

  const readBack = async (table: string, columns: string[], id: unknown): Promise<Row> => {
    const back = await pool.query(`SELECT ${u.checksumSelect(columns)} FROM ${table} WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const sameContent = (row: Row, back: Row) => { expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 }); };
  const roundTrip = async (table: string, columns: string[], row: Row): Promise<void> => {
    await u.insertRow(pool, table, columns, row);
    sameContent(row, await readBack(table, columns, row.id));
  };

  describe('validated replays', () => {
    const replayDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: objectId(oid()),
      flowId,
      taskId: 'step-1',
      iteration: 0,
      taskTitle: 'Summarise the \u0000quarter',
      referenceTaskDescription: '',
      referenceWorkspaceIds: [],
      agentName: '',
      createdBy: ownerId.toUpperCase(),
      referenceExecutionId: goneExecutionId,
      referenceExecutionNumber: 1,
      validationVersion: 2,
      status: 'active',
      mode: 'strict_replay',
      referenceOutput: '# Summary\nhello',
      preserveOutputFormat: false,
      formatGuideStatus: 'disabled',
      outputFormatGuide: null,
      toolCalls: [{ callIndex: 0, toolName: 'search', args: { q: 'x', since: at('2026-01-01T00:00:00Z') }, outputSummary: 'ok', status: 'completed', durationMs: 12, error: null }],
      llmPromptTrace: [],
      reasoningChain: [{ id: 'r1', type: 'analysis', label: 'Read', description: 'Read the input.', confidence: 0.8 }],
      fingerprints: { inputContextHash: 'abc', nodeSnapshotHash: null },
      referenceNodeSnapshot: { id: 'step-1', agentId: objectId(ownerId) },
      replayConfig: { replayOutputFormat: true, replayToolTrace: true, replayReasoningChain: true },
      isStale: false,
      staleReasons: [],
      label: 'Golden',
      __v: 0,
      ...stamp,
      ...over,
    });

    it('promotes the filtered fields, keeps the template body as stored and reads back identical', async () => {
      const doc = replayDoc();
      const row = u.buildReplay(doc);
      expect(row).toMatchObject({
        flow_id: flowId,
        task_id: 'step-1',
        iteration: 0,
        task_title: 'Summarise the quarter',
        created_by: ownerId,
        reference_execution_id: goneExecutionId,
        validation_version: 2,
        status: 'active',
        mode: 'strict_replay',
        is_stale: false,
        label: 'Golden',
        created_at: stamp.createdAt,
      });
      const body = row.doc as Record<string, unknown>;
      for (const key of ['_id', '__v', 'createdAt', 'updatedAt', 'flowId', 'taskId', 'status', 'mode', 'isStale', 'label', 'validationVersion']) {
        expect(body).not.toHaveProperty(key);
      }
      expect(body).toMatchObject({
        outputFormatGuide: null,
        toolCalls: [{ callIndex: 0, toolName: 'search', args: { q: 'x', since: '2026-01-01T00:00:00.000Z' } }],
        referenceNodeSnapshot: { id: 'step-1', agentId: ownerId },
      });
      expect(u.validateReplay(row, refs())).toBeNull();
      await roundTrip('playbook.validated_replays', u.REPLAY_COLUMNS, row);

      // Read as the services do: the stored legacy mode, normalised by the readers and the JSON view.
      const record = await replays.findInTask(String(row.id), flowId, 'step-1');
      expect(record).toMatchObject({ mode: 'strict_replay', referenceExecutionId: goneExecutionId, label: 'Golden', referenceOutput: '# Summary\nhello', createdAt: stamp.createdAt });
      expect(toValidatedReplayJson(record!).mode).toBe('replay_strict');
      expect((await replays.findActive(flowId, 'step-1'))?.id).toBe(row.id);
    });

    it('maps a minimal legacy document and fills the promoted defaults', async () => {
      const row = u.buildReplay(replayDoc({ _id: objectId(oid()), validationVersion: 3, status: undefined, mode: undefined, isStale: undefined, label: undefined, fingerprints: undefined }));
      expect(row).toMatchObject({ status: 'active', mode: 'replay_strict', is_stale: false, label: null });
      expect(row.doc).not.toHaveProperty('fingerprints');
      await roundTrip('playbook.validated_replays', u.REPLAY_COLUMNS, row);
    });

    it('reports a replay whose flow is gone, or what the columns cannot hold', () => {
      const verdict = (over: Record<string, unknown>, flows?: string[]) => u.validateReplay(u.buildReplay(replayDoc(over)), refs(flows));
      expect(verdict({ flowId: goneFlowId })).toMatch(/dangling flow_id/);
      expect(verdict({}, [])).toMatch(/flow gone from PG/);
      expect(verdict({ status: 'deleted' })).toMatch(/status 'deleted'/);
      expect(verdict({ mode: 'live' })).toMatch(/mode 'live'/);
      expect(verdict({ taskId: '' })).toMatch(/task_id is empty/);
      expect(() => u.buildReplay(replayDoc({ flowId: 'not-a-flow' }))).toThrow(BackfillError);
    });

    it('records a second replay with the same task version as a failure of that row', async () => {
      const doc = replayDoc({ _id: objectId(oid()), taskId: `dup-${oid()}` });
      await u.insertRow(pool, 'playbook.validated_replays', u.REPLAY_COLUMNS, u.buildReplay(doc));
      await expect(u.insertRow(pool, 'playbook.validated_replays', u.REPLAY_COLUMNS, u.buildReplay({ ...doc, _id: objectId(oid()) })))
        .rejects.toMatchObject({ constraint: 'uq_playbook_validated_replays_version' });
      // Re-running the same row is a no-op.
      await u.insertRow(pool, 'playbook.validated_replays', u.REPLAY_COLUMNS, u.buildReplay(doc));
    });
  });

  describe('replay run reports', () => {
    const reportDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: objectId(oid()),
      executionId: goneExecutionId,
      flowId,
      taskId: 'step-1',
      iteration: 0,
      replayId: oid(),
      validationVersion: 1,
      mode: 'replay_flex',
      applied: true,
      confidenceScore: 42,
      appliedSections: [],
      skippedSections: ['tool_policy'],
      invalidationReasons: ['confidence_below_threshold'],
      confidenceFactors: { nodeSnapshotHash: 0 },
      outputContractEvaluated: false,
      outputContractPassed: false,
      structuralDriftScore: null,
      toolPolicyScore: null,
      verdict: 'skipped',
      overallScore: null,
      verdictReasons: ['replay_not_applied'],
      structuralDriftReasons: [],
      contextDrift: 12.5,
      driftFindings: [],
      blockedBy: ['confidence_below_threshold'],
      intentStatus: { status: 'not_evaluated', reason: 'evaluation_pending' },
      postRunEvaluation: null,
      hitlSummary: { baselineHitlCount: 0, runtimeHitlCount: 0, reusedMemoryCount: 0, newClarificationCount: 0, approvalReaskedCount: 0, hitlContextDrift: false, findings: [] },
      __v: 0,
      ...stamp,
      ...over,
    });

    it('maps the legacy skipped verdict to unknown, keeps the gate fields in doc and reads back identical', async () => {
      const row = u.buildReport(reportDoc());
      expect(row).toMatchObject({ execution_id: goneExecutionId, flow_id: flowId, verdict: 'unknown', overall_score: null, mode: 'replay_flex' });
      expect(row.doc).toMatchObject({ applied: true, confidenceScore: 42, contextDrift: 12.5, verdictReasons: ['replay_not_applied'] });
      expect(row.doc).not.toHaveProperty('verdict');
      expect(u.validateReport(row, refs())).toBeNull();
      await roundTrip('playbook.replay_run_reports', u.REPORT_COLUMNS, row);

      const record = await reports.findLatest({ executionId: goneExecutionId, taskId: 'step-1', replayId: String(row.replay_id) });
      expect(record).toMatchObject({ id: row.id, verdict: 'unknown', contextDrift: 12.5, applied: true });
    });

    it('keeps a scored verdict and a post-run evaluation date', async () => {
      const row = u.buildReport(reportDoc({
        verdict: 'pass',
        overallScore: 88.5,
        postRunEvaluation: { judgeUsed: true, judgeModel: 'm', evaluatedAt: at('2026-03-02T00:00:00Z'), verdict: 'match', summary: 's', recommendedAction: 'accept' },
      }));
      expect(row).toMatchObject({ verdict: 'pass', overall_score: 88.5 });
      await roundTrip('playbook.replay_run_reports', u.REPORT_COLUMNS, row);
      expect((await reports.findById(String(row.id)))?.postRunEvaluation?.evaluatedAt).toEqual(at('2026-03-02T00:00:00Z'));
    });

    it('reports a report whose flow is gone or whose verdict the column cannot hold', () => {
      expect(u.validateReport(u.buildReport(reportDoc({ flowId: goneFlowId })), refs())).toMatch(/dangling flow_id/);
      expect(u.validateReport(u.buildReport(reportDoc({ verdict: 'maybe' })), refs())).toMatch(/verdict 'maybe'/);
      expect(u.validateReport(u.buildReport(reportDoc({ mode: '' })), refs())).toMatch(/mode is empty/);
    });
  });

  describe('evaluation baselines', () => {
    const baselineDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: objectId(oid()),
      flowId,
      taskId: `eval-${oid()}`,
      iteration: 1,
      sourceExecutionId: goneExecutionId,
      sourceMode: 'current_inputs',
      inputSnapshots: [{ sourceTaskId: 'step-0', output: 'upstream \u0000text', artifacts: [{ kind: 'document', name: 'a.pdf', metadata: { pages: 3 } }] }],
      createdByUserId: ownerId,
      replacedAt: null,
      __v: 0,
      ...stamp,
      ...over,
    });

    it('maps a baseline with its input snapshots and reads it back identical', async () => {
      const row = u.buildBaseline(baselineDoc());
      expect(row).toMatchObject({ source_mode: 'current_inputs', replaced_at: null, input_snapshots: [{ sourceTaskId: 'step-0', output: 'upstream text' }] });
      expect(u.validateBaseline(row, refs())).toBeNull();
      await roundTrip('playbook.evaluation_baselines', u.BASELINE_COLUMNS, row);
      expect((await baselines.findActive(flowId, String(row.task_id)))?.id).toBe(row.id);

      const replaced = u.buildBaseline(baselineDoc({ replacedAt: at('2026-03-05T00:00:00Z') }));
      await roundTrip('playbook.evaluation_baselines', u.BASELINE_COLUMNS, replaced);
      expect(await baselines.findActive(flowId, String(replaced.task_id))).toBeNull();
    });

    it('reports a baseline whose flow is gone or whose source mode is unknown', () => {
      expect(u.validateBaseline(u.buildBaseline(baselineDoc({ flowId: goneFlowId })), refs())).toMatch(/dangling flow_id/);
      expect(u.validateBaseline(u.buildBaseline(baselineDoc({ sourceMode: 'upload' })), refs())).toMatch(/source_mode 'upload'/);
    });
  });

  describe('evaluation executions', () => {
    const evaluationDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: objectId(oid()),
      flowId,
      executionId: goneExecutionId,
      taskId: `eval-${oid()}`,
      iteration: 0,
      taskTitle: 'Check the summary',
      baselineId: oid(),
      mode: 'hybrid',
      status: 'completed',
      score: 81.5,
      verdict: 'pass',
      semanticScore: 0.9,
      expectation: '',
      rubricVersion: 'evaluation-node-v1',
      judgeModel: 'judge',
      summary: 'Fine \u0000summary',
      findings: [{ severity: 'info', category: 'semantic', message: 'ok', sourceTaskId: 'step-0' }],
      metrics: { connectedInputCount: 2, artifactCount: 0, completedUpstreamSteps: 2, failedUpstreamSteps: 0, totalDurationMs: 1500 },
      startedAt: at('2026-03-01T09:00:00Z'),
      completedAt: at('2026-03-01T09:01:00Z'),
      __v: 0,
      ...stamp,
      ...over,
    });

    it('maps an evaluation with its scores, findings and metrics and reads it back identical', async () => {
      const row = u.buildEvaluation(evaluationDoc());
      expect(row).toMatchObject({ score: 81.5, semantic_score: 0.9, summary: 'Fine summary', reference_score: null, error: null });
      expect(u.validateEvaluation(row, refs())).toBeNull();
      await roundTrip('playbook.evaluation_executions', u.EVALUATION_COLUMNS, row);

      const record = await evaluations.findLatestForTask(goneExecutionId, String(row.task_id));
      expect(record).toMatchObject({ id: row.id, score: 81.5, verdict: 'pass', metrics: { totalDurationMs: 1500 }, completedAt: at('2026-03-01T09:01:00Z') });
      expect(record).not.toHaveProperty('referenceScore');
      expect(record).not.toHaveProperty('error');
    });

    it('fills the schema defaults of a sparse document', async () => {
      const row = u.buildEvaluation(evaluationDoc({
        status: undefined, expectation: undefined, rubricVersion: undefined, findings: undefined, metrics: undefined, score: undefined, verdict: undefined,
        judgeModel: undefined, summary: undefined, startedAt: undefined, completedAt: undefined, baselineId: undefined,
      }));
      expect(row).toMatchObject({ status: 'completed', expectation: '', rubric_version: 'evaluation-node-v1', findings: [], metrics: {}, score: null, verdict: null, started_at: null, baseline_id: null });
      await roundTrip('playbook.evaluation_executions', u.EVALUATION_COLUMNS, row);
    });

    it('reports an evaluation whose flow is gone or whose enums the columns cannot hold', () => {
      expect(u.validateEvaluation(u.buildEvaluation(evaluationDoc({ flowId: goneFlowId })), refs())).toMatch(/dangling flow_id/);
      expect(u.validateEvaluation(u.buildEvaluation(evaluationDoc({ mode: 'judge' })), refs())).toMatch(/mode 'judge'/);
      expect(u.validateEvaluation(u.buildEvaluation(evaluationDoc({ status: 'queued' })), refs())).toMatch(/status 'queued'/);
      expect(u.validateEvaluation(u.buildEvaluation(evaluationDoc({ verdict: 'meh' })), refs())).toMatch(/verdict 'meh'/);
      expect(() => u.buildEvaluation(evaluationDoc({ _id: 'short' }))).toThrow(BackfillError);
    });
  });
});
