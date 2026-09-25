import { eq } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import type { EvaluationIteration } from '../evaluation.types';
import { PgEvaluationDatasetStore } from './pg-evaluation-dataset.store';
import { PgEvaluationRunStore } from './pg-evaluation-run.store';
import { PgEvaluationScenarioStore } from './pg-evaluation-scenario.store';
import { PgEvaluationSettingsStore } from './pg-evaluation-settings.store';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 15));

describeIntegration('PgEvaluation stores (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const datasets = new PgEvaluationDatasetStore(db as never);
  const runs = new PgEvaluationRunStore(db as never);
  const scenarios = new PgEvaluationScenarioStore(db as never);
  const settings = new PgEvaluationSettingsStore(db as never);

  let userId: string;
  let agentTypeId: string;
  let agentId: string;

  const items = [{ question: 'Q1?', reference_answer: 'A1' }, { question: 'Q2?', reference_answer: 'A2' }];
  const iteration = (index: number, runIndex = 1): EvaluationIteration => ({
    iterationIndex: index,
    question: `q${index}`,
    agentAnswer: `a${index}`,
    referenceAnswer: `r${index}`,
    responseMatchScore: { score: 0.5, reasoning: '' },
    finalResponseMatchV2: { score: 0.6, reasoning: '' },
    hallucinationsV1: { score: 0.1, reasoning: '' },
    timestamp: new Date().toISOString(),
    runIndex,
  });

  beforeAll(async () => {
    userId = oid();
    agentTypeId = oid();
    agentId = oid();
    await db.insert(schema.identityUsers).values({
      id: userId,
      email: `agent-eval-${userId.slice(-8)}@example.com`,
      passwordHash: 'hash',
      emailVerified: true,
      status: 'active',
    });
    await db.insert(schema.catalogAgentTypes).values({ id: agentTypeId, name: 'eval spec type', slug: `eval-spec-${agentTypeId}` });
    await db.insert(schema.agents).values({
      id: agentId,
      name: 'eval spec agent',
      role: 'tester',
      agentTypeId,
      createdBy: userId,
    });
  });

  afterAll(async () => {
    // Deleting the agent cascades its evaluations and scenarios; datasets are owned by the user row.
    await db.delete(schema.agents).where(eq(schema.agents.id, agentId));
    await db.delete(schema.agentEvaluationDatasets).where(eq(schema.agentEvaluationDatasets.createdBy, userId));
    await db.delete(schema.agentEvaluationSettings);
    await db.delete(schema.catalogAgentTypes).where(eq(schema.catalogAgentTypes.id, agentTypeId));
    await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, userId));
    await close();
  });

  describe('datasets', () => {
    it('round-trips a dataset and lists a creator’s datasets oldest first', async () => {
      const first = await datasets.create({ name: 'first', items, createdBy: userId });
      await settle();
      const second = await datasets.create({ name: 'second', items: [], createdBy: userId });

      expect(first).toMatchObject({ name: 'first', items, createdBy: userId });
      expect(first).not.toHaveProperty('workspaceId');
      expect(await datasets.findById(first.id)).toEqual(first);
      expect((await datasets.findByCreator(userId)).map((d) => d.id)).toEqual([first.id, second.id]);
    });

    it('treats a malformed or unknown id as not found and deletes idempotently', async () => {
      const created = await datasets.create({ name: 'to delete', items, createdBy: userId });
      expect(await datasets.findById('not-an-id')).toBeNull();
      expect(await datasets.findById(oid())).toBeNull();
      expect(await datasets.findByCreator('nope')).toEqual([]);

      await datasets.deleteById(created.id);
      await datasets.deleteById(created.id);
      await datasets.deleteById('not-an-id');
      expect(await datasets.findById(created.id)).toBeNull();
    });

    it('strips U+0000 from the name and items, which jsonb and text reject', async () => {
      const created = await datasets.create({
        name: 'nul\u0000name',
        items: [{ question: 'q\u0000', reference_answer: 'a\u0000' }],
        createdBy: userId,
      });
      expect(created.name).toBe('nulname');
      expect(created.items).toEqual([{ question: 'q', reference_answer: 'a' }]);
    });
  });

  describe('evaluation runs', () => {
    const newRun = async (over: Partial<Parameters<PgEvaluationRunStore['create']>[0]> = {}) => {
      const dataset = await datasets.create({ name: 'run dataset', items, createdBy: userId });
      return runs.create({
        agentId,
        scenarioName: 'scenario',
        datasetId: dataset.id,
        mode: 'non_strict',
        numRuns: 2,
        createdBy: userId,
        ...over,
      });
    };

    it('creates a processing run with no results and returns it by id', async () => {
      const run = await newRun();
      expect(run).toMatchObject({ status: 'processing', completedRuns: 0, numRuns: 2, results: [], agentId, createdBy: userId });
      expect(run).not.toHaveProperty('error');
      expect(await runs.findById(run.id)).toEqual(run);
    });

    it('appends iterations and counts each run once', async () => {
      const run = await newRun();
      await runs.appendRunResults(run.id, [iteration(1), iteration(2)]);
      await runs.appendRunResults(run.id, [iteration(1, 2)]);

      const stored = await runs.findById(run.id);
      expect(stored?.completedRuns).toBe(2);
      expect(stored?.results.map((r) => `${r.runIndex}:${r.iterationIndex}`)).toEqual(['1:1', '1:2', '2:1']);
    });

    it('does not lose iterations when runs are appended concurrently', async () => {
      const run = await newRun({ numRuns: 8 });
      await Promise.all(
        Array.from({ length: 8 }, (_, i) => runs.appendRunResults(run.id, [iteration(1, i + 1), iteration(2, i + 1)])),
      );

      const stored = await runs.findById(run.id);
      expect(stored?.completedRuns).toBe(8);
      expect(stored?.results).toHaveLength(16);
      expect(new Set(stored?.results.map((r) => r.runIndex)).size).toBe(8);
    });

    it('strips U+0000 from appended results', async () => {
      const run = await newRun();
      await runs.appendRunResults(run.id, [{ ...iteration(1), agentAnswer: 'bin\u0000ary' }]);
      expect((await runs.findById(run.id))?.results[0].agentAnswer).toBe('binary');
    });

    it('appending to a deleted run is a no-op', async () => {
      const run = await newRun();
      await runs.deleteById(run.id);
      await expect(runs.appendRunResults(run.id, [iteration(1)])).resolves.toBeUndefined();
      expect(await runs.findById(run.id)).toBeNull();
    });

    it('finalizes with an error, and a later finalize without one keeps it', async () => {
      const run = await newRun();
      const failed = await runs.finalize(run.id, 'failed', 'boom');
      expect(failed).toMatchObject({ status: 'failed', error: 'boom' });

      const completed = await runs.finalize(run.id, 'completed');
      expect(completed).toMatchObject({ status: 'completed', error: 'boom' });
      expect(await runs.finalize(oid(), 'completed')).toBeNull();
    });

    it('lists an agent’s runs newest first', async () => {
      const a = await newRun({ scenarioName: 'older' });
      await settle();
      const b = await newRun({ scenarioName: 'newer' });

      const listed = (await runs.findByAgent(agentId)).map((r) => r.id);
      expect(listed.indexOf(b.id)).toBeLessThan(listed.indexOf(a.id));
    });

    it('nulls dataset_id when its dataset is deleted, keeping the run', async () => {
      const run = await newRun();
      await datasets.deleteById(run.datasetId as string);

      const stored = await runs.findById(run.id);
      expect(stored).not.toBeNull();
      expect(stored).not.toHaveProperty('datasetId');
    });

    it('rejects a mode the CHECK constraint does not allow', async () => {
      await expect(newRun({ mode: 'sloppy' as never })).rejects.toThrow();
    });
  });

  describe('scenarios', () => {
    it('creates with defaults, updates partially and lists by agent', async () => {
      const dataset = await datasets.create({ name: 'scenario dataset', items, createdBy: userId });
      const created = await scenarios.create({ name: 'smoke', agentId, datasetId: dataset.id });
      expect(created).toMatchObject({ name: 'smoke', agentId, datasetId: dataset.id, numRuns: 1, mode: 'non_strict' });

      const updated = await scenarios.update(created.id, { numRuns: 4, mode: 'strict' });
      expect(updated).toMatchObject({ name: 'smoke', numRuns: 4, mode: 'strict' });
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

      expect((await scenarios.findByAgent(agentId)).map((s) => s.id)).toContain(created.id);
      expect(await scenarios.findById(created.id)).toEqual(updated);
      expect(await scenarios.update(oid(), { name: 'x' })).toBeNull();
    });

    it('cascades when its dataset is deleted', async () => {
      const dataset = await datasets.create({ name: 'cascade dataset', items, createdBy: userId });
      const scenario = await scenarios.create({ name: 'doomed', agentId, datasetId: dataset.id });

      await datasets.deleteById(dataset.id);
      expect(await scenarios.findById(scenario.id)).toBeNull();
    });

    it('deletes by id idempotently', async () => {
      const dataset = await datasets.create({ name: 'del dataset', items, createdBy: userId });
      const scenario = await scenarios.create({ name: 'gone', agentId, datasetId: dataset.id });
      await scenarios.deleteById(scenario.id);
      await scenarios.deleteById(scenario.id);
      expect(await scenarios.findById(scenario.id)).toBeNull();
    });
  });

  describe('settings singleton', () => {
    const next = (enabled: boolean) => ({
      responseReliability: {
        enabled,
        mode: 'informative' as const,
        judgeModelId: null,
        maxConcurrentEvaluations: 3,
        timeoutMs: 30_000,
        maxFindings: 5,
        correction: {
          threshold: 70,
          maxAttempts: 1,
          maxDurationMs: 60_000,
          allowAdditionalDocumentRetrieval: false,
          allowConnectorQueries: false,
          allowCalculationReruns: false,
          failureBehavior: 'publish_with_warning' as const,
          showOriginalAnswer: true,
        },
      },
    });

    it('is empty until first written, then upserts a single row', async () => {
      await db.delete(schema.agentEvaluationSettings);
      expect(await settings.find()).toBeNull();

      await settings.upsert(next(false));
      await settings.upsert(next(true));

      expect(await settings.find()).toEqual({ responseReliability: next(true).responseReliability });
      expect(await db.select().from(schema.agentEvaluationSettings)).toHaveLength(1);
    });
  });
});
