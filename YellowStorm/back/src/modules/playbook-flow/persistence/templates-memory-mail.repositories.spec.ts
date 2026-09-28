import { eq, inArray } from 'drizzle-orm';
import { isForeignKeyViolation, isUniqueViolation, newObjectId, withTransaction } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { NodeTemplateRepository, type NewNodeTemplate } from './node-template.repository';
import { PromptTemplateRepository, type PromptTemplateContent } from './prompt-template.repository';
import { OutputFormatRepository } from './output-format.repository';
import { HitlMemoryRepository, toHitlMemoryJson } from './hitl-memory.repository';
import { MailEventLedgerRepository, type NewMailEventLedger } from './mail-event-ledger.repository';

/** Thrown to roll back a test that rewrites a whole (shared) catalogue. */
class Rollback extends Error {}

describeIntegration('template, output-format, HITL memory and mail ledger repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const nodeTemplates = new NodeTemplateRepository(db as never);
  const prompts = new PromptTemplateRepository(db as never);
  const outputFormats = new OutputFormatRepository(db as never);
  const memories = new HitlMemoryRepository(db as never);
  const ledger = new MailEventLedgerRepository(db as never);

  const ownerId = oid();
  const otherId = oid();
  const users = [ownerId, otherId];
  const flowId = oid();
  const otherFlowId = oid();
  const run = `a2${oid().slice(-8)}`;
  const templateIds: string[] = [];
  const promptKeys: string[] = [];

  /** Runs `fn` in a transaction that is always rolled back: the catalogue tables are shared. */
  const rolledBack = async (fn: () => Promise<void>): Promise<void> => {
    await expect(withTransaction(db, async () => {
      await fn();
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);
  };

  beforeAll(async () => {
    for (const id of users) {
      await db.insert(schema.identityUsers).values({ id, email: `a2-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
    await db.insert(schema.playbookFlows).values([
      { id: flowId, ownerId, name: `a2 flow ${flowId}` },
      { id: otherFlowId, ownerId: otherId, name: `a2 flow ${otherFlowId}` },
    ]);
  });

  afterAll(async () => {
    // Flows cascade to their output formats, HITL memories and mail ledger entries.
    await db.delete(schema.playbookFlows).where(inArray(schema.playbookFlows.ownerId, users));
    if (templateIds.length) await db.delete(schema.playbookNodeTemplates).where(inArray(schema.playbookNodeTemplates.id, templateIds));
    if (promptKeys.length) await db.delete(schema.playbookPromptTemplates).where(inArray(schema.playbookPromptTemplates.key, promptKeys));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, users));
    await close();
  });

  describe('node templates', () => {
    const newTemplate = (over: Partial<NewNodeTemplate> = {}): NewNodeTemplate => ({
      key: `${run}-${oid()}`, nodeType: 'router', title: 'Router', category: 'analysis', ...over,
    });
    const create = async (over: Partial<NewNodeTemplate> = {}) => {
      const created = await nodeTemplates.create(newTemplate(over));
      templateIds.push(created.id);
      return created;
    };

    it('creates a template with the Mongoose defaults and casts its configs like the old schema', async () => {
      const created = await create({
        key: `  ${run}-cast  `,
        title: ' Router ',
        inputPorts: [{ id: ' in ', name: 'In', artifactKind: 'text', required: true, stray: 1 } as never, 'junk' as never],
        outputPorts: [{ id: 'out', name: 'Out', artifactKind: 'text', required: true } as never],
        routerConfig: { outputLabels: ['a'], mode: 'ai', prompt: 'x', conditions: [{ label: ' done ', operator: 'equals' }] } as never,
        iteratorConfig: { source: ' {{items}} ', mode: 'item', _id: 'legacy' } as never,
        humanApprovalConfig: {} as never,
        retryPolicy: { maxRetries: 3 },
        requiredToolNames: ['a\u0000b'],
        createdBy: ownerId.toUpperCase(),
        updatedBy: 'not-an-id',
      });
      expect(created).toMatchObject({
        key: `${run}-cast`,
        nodeType: 'router',
        title: 'Router',
        description: null,
        promptTemplate: '',
        enabled: true,
        version: 1,
        isBuiltIn: false,
        createdBy: ownerId,
        updatedBy: null,
        requiredToolNames: ['ab'],
        inputPorts: [{ id: 'in', name: 'In', artifactKind: 'text', required: true }],
        outputPorts: [{ id: 'out', name: 'Out', artifactKind: 'text' }],
        routerConfig: { outputLabels: ['a'], maxIterations: 1, conditions: [{ label: 'done', sourceNode: null, sourcePort: null, path: null, operator: 'equals', value: null }], defaultLabel: null },
        iteratorConfig: { source: '{{items}}', mode: 'item', batchSize: null, itemVariable: null, outputVariable: null, errorStrategy: 'stop' },
        humanApprovalConfig: { promptTemplate: '', timeoutSeconds: null },
        retryPolicy: { maxRetries: 3, delayMs: 1000 },
      });
      expect(await nodeTemplates.findById(created.id)).toEqual(created);
      expect(await nodeTemplates.findById('nope')).toBeNull();
    });

    it('refuses a second template with the same key and reports taken keys except the template itself', async () => {
      const a = await create();
      const clash = await nodeTemplates.create(newTemplate({ key: a.key })).catch((e: unknown) => e);
      expect(isUniqueViolation(clash, 'uq_playbook_node_templates_key')).toBe(true);
      expect(await nodeTemplates.keyTaken(a.key)).toBe(true);
      expect(await nodeTemplates.keyTaken(a.key, a.id)).toBe(false);
      expect(await nodeTemplates.keyTaken(`${run}-free`)).toBe(false);
    });

    it('updates fields, bumps version in the statement, and maps nulls to what a Mongo read gave back', async () => {
      const a = await create({ enabled: true, inputPorts: [{ id: 'p', name: 'P', artifactKind: 'text', required: false }] });
      const results = await Promise.all([
        nodeTemplates.update(a.id, { title: 'T1', updatedBy: otherId }),
        nodeTemplates.update(a.id, { description: ' d ' }),
      ]);
      expect(results.every((r) => r !== null)).toBe(true);
      const after = await nodeTemplates.findById(a.id);
      expect(after).toMatchObject({ title: 'T1', description: 'd', version: 3, updatedBy: otherId });
      expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());

      const nulls = await nodeTemplates.update(a.id, { nodeType: null as never, enabled: null as never, inputPorts: null as never, requiredToolNames: null as never, routerConfig: null });
      expect(nulls).toMatchObject({ nodeType: 'agent', enabled: false, inputPorts: [], requiredToolNames: [], routerConfig: null, version: 4 });
      expect(await nodeTemplates.update(oid(), { title: 'x' })).toBeNull();
      expect(await nodeTemplates.update('bad', { title: 'x' })).toBeNull();
    });

    it('lists by category then title byte-wise, and only the enabled ones on request', async () => {
      const category = `${run}-cat`;
      const b = await create({ category, title: 'b' });
      const upper = await create({ category, title: 'Z' });
      const off = await create({ category, title: 'a', enabled: false });
      const mine = (await nodeTemplates.list()).filter((t) => t.category === category).map((t) => t.id);
      expect(mine).toEqual([upper.id, off.id, b.id]);
      const enabled = (await nodeTemplates.list({ enabledOnly: true })).filter((t) => t.category === category).map((t) => t.id);
      expect(enabled).toEqual([upper.id, b.id]);
    });

    it('deletes by id', async () => {
      const a = await create();
      expect(await nodeTemplates.delete(a.id)).toBe(true);
      expect(await nodeTemplates.delete(a.id)).toBe(false);
      expect(await nodeTemplates.delete('bad')).toBe(false);
    });

    it('replaces the catalogue by key: keeps the id of a kept key, resets its version, deletes the rest', async () => {
      const kept = await create({ title: 'old' });
      await nodeTemplates.update(kept.id, { title: 'edited' });
      const dropped = await create();
      await rolledBack(async () => {
        const fresh = newTemplate({ nodeType: 'agent' });
        await nodeTemplates.replaceAll([
          newTemplate({ key: kept.key, title: 'imported', isBuiltIn: true, createdBy: otherId }),
          fresh,
        ]);
        const all = await nodeTemplates.list();
        expect(all.map((t) => t.key).sort()).toEqual([kept.key, fresh.key].sort());
        const replaced = all.find((t) => t.key === kept.key)!;
        expect(replaced).toMatchObject({ id: kept.id, title: 'imported', version: 1, isBuiltIn: true, createdBy: otherId });
        expect(replaced.createdAt).toEqual(kept.createdAt);
        expect(await nodeTemplates.findById(dropped.id)).toBeNull();
      });
      expect(await nodeTemplates.findById(dropped.id)).not.toBeNull();
    });
  });

  describe('prompt templates', () => {
    const content = (over: Partial<PromptTemplateContent> = {}): PromptTemplateContent => {
      const item = { key: `${run}.${oid()}`, title: 'Prompt', category: 'intent', description: 'd', systemTemplate: 'sys', userTemplate: 'usr', enabled: true, version: 2, isBuiltIn: true, ...over };
      promptKeys.push(item.key);
      return item;
    };

    it('seeds the missing templates once and leaves a concurrent seeder\'s rows alone', async () => {
      const a = content();
      const b = content();
      const inserted = await Promise.all([prompts.insertMissing([a, b]), prompts.insertMissing([a, b])]);
      expect(inserted.reduce((sum, n) => sum + n, 0)).toBe(2);
      expect(await prompts.findByKey(a.key)).toMatchObject({ key: a.key, systemTemplate: 'sys', version: 2, isBuiltIn: true, createdBy: null, updatedBy: null });
      expect((await prompts.findVersions([a.key, b.key, 'nope'])).sort((x, y) => x.key.localeCompare(y.key)))
        .toEqual([{ key: a.key, version: 2, isBuiltIn: true }, { key: b.key, version: 2, isBuiltIn: true }].sort((x, y) => x.key.localeCompare(y.key)));
      expect(await prompts.isEmpty()).toBe(false);
    });

    it('upgrades a built-in template only while it is built in and older than the seed', async () => {
      const builtIn = content();
      const custom = content({ isBuiltIn: false });
      await prompts.insertMissing([builtIn, custom]);
      await prompts.upsertByKey(builtIn.key, { title: 'Edited', category: 'intent', description: '' }, ownerId);
      expect(await prompts.upgradeBuiltIn({ ...builtIn, version: 3 })).toBe(false);
      expect(await prompts.upgradeBuiltIn({ ...builtIn, version: 4, systemTemplate: 'v4' })).toBe(true);
      expect(await prompts.findByKey(builtIn.key)).toMatchObject({ version: 4, systemTemplate: 'v4', title: 'Prompt', updatedBy: null, createdBy: ownerId });
      expect(await prompts.upgradeBuiltIn({ ...custom, version: 9 })).toBe(false);
    });

    it('creates or edits by key in one statement, keeping what the edit leaves out', async () => {
      const key = content().key;
      const created = await prompts.upsertByKey(key, { title: ' New ', category: 'c', description: 'x', userTemplate: 'u' }, ownerId);
      expect(created).toMatchObject({ key, title: 'New', version: 1, isBuiltIn: false, systemTemplate: '', userTemplate: 'u', enabled: true, createdBy: ownerId, updatedBy: ownerId });
      const edits = await Promise.all([
        prompts.upsertByKey(key, { title: 'A', category: 'c', description: '', enabled: false }, otherId),
        prompts.upsertByKey(key, { title: 'B', category: 'c', description: '', systemTemplate: 's' }, otherId),
      ]);
      expect(edits.map((e) => e.version).sort()).toEqual([2, 3]);
      expect(await prompts.findByKey(key)).toMatchObject({ version: 3, userTemplate: 'u', systemTemplate: 's', enabled: false, createdBy: ownerId, updatedBy: otherId });
      expect(created.createdAt).toEqual((await prompts.findByKey(key))!.createdAt);

      const seeded = content();
      await prompts.insertMissing([seeded]);
      expect(await prompts.upsertByKey(seeded.key, { title: 'x', category: 'c', description: '' }, ownerId)).toMatchObject({ createdBy: ownerId, isBuiltIn: true, version: 3 });
    });

    it('lists by category and title, the enabled ones on request, and deletes by key', async () => {
      const category = `${run}-p`;
      const off = content({ category, title: 'a', enabled: false });
      const on = content({ category, title: 'B' });
      await prompts.insertMissing([off, on]);
      expect((await prompts.list()).filter((p) => p.category === category).map((p) => p.key)).toEqual([on.key, off.key]);
      expect((await prompts.list({ enabledOnly: true })).filter((p) => p.category === category).map((p) => p.key)).toEqual([on.key]);
      expect(await prompts.deleteByKey(off.key)).toBe(true);
      expect(await prompts.deleteByKey(off.key)).toBe(false);
    });

    it('replaces the catalogue by key and empties it for an empty import', async () => {
      const kept = content();
      const dropped = content();
      await prompts.insertMissing([kept, dropped]);
      const before = await prompts.findByKey(kept.key);
      await rolledBack(async () => {
        const fresh = content({ isBuiltIn: false });
        await prompts.replaceAll([{ ...kept, title: 'imported', version: 1, isBuiltIn: false, createdBy: otherId, updatedBy: otherId }, fresh]);
        const all = await prompts.list();
        expect(all.map((p) => p.key).sort()).toEqual([kept.key, fresh.key].sort());
        expect(all.find((p) => p.key === kept.key)).toMatchObject({ id: before!.id, title: 'imported', version: 1, isBuiltIn: false, createdBy: otherId, createdAt: before!.createdAt });
        await prompts.replaceAll([]);
        expect(await prompts.isEmpty()).toBe(true);
      });
      expect(await prompts.findByKey(dropped.key)).not.toBeNull();
    });
  });

  describe('output formats', () => {
    const capture = (nodeId: string, over: Partial<Parameters<OutputFormatRepository['capture']>[0]> = {}) => outputFormats.capture({
      flowId, nodeId, createdBy: ownerId, sourceExecutionId: oid(), sourceExecutionNumber: 1, sourceOutput: '# out\u0000', ...over,
    });

    it('numbers concurrent captures of a node and leaves exactly one active', async () => {
      const nodeId = `node-${oid()}`;
      const captured = await Promise.all([capture(nodeId), capture(nodeId), capture(nodeId)]);
      expect(captured.map((c) => c.templateVersion).sort()).toEqual([1, 2, 3]);
      const rows = await db.select().from(schema.playbookOutputFormats).where(eq(schema.playbookOutputFormats.nodeId, nodeId));
      expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
      const active = await outputFormats.findActive(flowId, nodeId);
      expect(active).toMatchObject({ templateVersion: 3, status: 'active', generationStatus: 'pending', sourceOutput: '# out', formatGuide: null, llmPromptTrace: [] });
    });

    it('keeps an archived template archived, and keeps a source execution that does not exist (soft reference)', async () => {
      const nodeId = `node-${oid()}`;
      const first = await capture(nodeId);
      expect(await outputFormats.archiveActive(flowId, nodeId)).toBe(true);
      expect(await outputFormats.archiveActive(flowId, nodeId)).toBe(false);
      const second = await capture(nodeId);
      expect(second.templateVersion).toBe(2);
      expect((await outputFormats.findById(first.id))?.status).toBe('archived');
      expect(await outputFormats.findById(second.id)).toMatchObject({ sourceExecutionId: second.sourceExecutionId });
    });

    it('edits and lists the active templates, and stores the generation outcome', async () => {
      const a = `node-${oid()}`;
      const b = `node-${oid()}`;
      await capture(a);
      const tb = await capture(b);
      expect(await outputFormats.updateActive(flowId, a, { formatGuide: 'guide' })).toMatchObject({ nodeId: a, formatGuide: 'guide' });
      const touched = await outputFormats.updateActive(flowId, a, {});
      expect(touched).toMatchObject({ formatGuide: 'guide' });
      expect(await outputFormats.updateActive(flowId, `node-${oid()}`, { formatGuide: 'x' })).toBeNull();
      expect((await outputFormats.listActive(flowId, [a, b, 'none'])).map((t) => t.nodeId).sort()).toEqual([a, b].sort());
      expect(await outputFormats.listActive(flowId, [])).toEqual([]);
      expect(await outputFormats.findActive('bad', a)).toBeNull();

      const done = await outputFormats.setGeneration(tb.id, { formatGuide: 'g', generationStatus: 'ready', generationError: null });
      expect(done).toMatchObject({ formatGuide: 'g', generationStatus: 'ready', generationError: null });
      expect(await outputFormats.setGeneration(oid(), { formatGuide: null, generationStatus: 'failed', generationError: 'x' })).toBeNull();
    });

    it('refuses a template of a flow that does not exist', async () => {
      const error = await outputFormats.capture({ flowId: oid(), nodeId: 'n', createdBy: ownerId, sourceExecutionId: oid(), sourceExecutionNumber: 1, sourceOutput: null }).catch((e: unknown) => e);
      expect(isForeignKeyViolation(error)).toBe(true);
      await expect(capture('n', { createdBy: 'not-an-id' })).rejects.toThrow(/24-char hex/);
    });
  });

  describe('HITL memories', () => {
    const newMemory = (over: Partial<Parameters<HitlMemoryRepository['create']>[0]> = {}) => memories.create({
      ownerId, flowId, title: 'T', content: 'C\u0000', normalizedInstruction: 'N', ...over,
    });

    it('creates a memory with the Mongoose defaults and serialises it like toJSON()', async () => {
      const created = await newMemory();
      expect(created).toMatchObject({ ownerId, flowId, nodeId: null, memoryType: 'procedural', source: 'hitl_feedback', appliesTo: 'workflow', status: 'draft', sensitivity: 'normal', content: 'C' });
      const json = toHitlMemoryJson(created);
      expect(json).not.toHaveProperty('createdFromExecutionId');
      expect(json).not.toHaveProperty('createdFromInterruptId');
      expect(toHitlMemoryJson({ ...created, createdFromExecutionId: 'e1' }).createdFromExecutionId).toBe('e1');
      const error = await newMemory({ flowId: oid() }).catch((e: unknown) => e);
      expect(isForeignKeyViolation(error)).toBe(true);
      await expect(newMemory({ ownerId: 'not-an-id' })).rejects.toThrow(/24-char hex/);
    });

    it('lists, updates and deletes only the owner\'s memories of the flow', async () => {
      const older = await newMemory({ title: 'older' });
      const newer = await newMemory({ title: 'newer' });
      await memories.create({ ownerId: otherId, flowId, title: 'x', content: 'x', normalizedInstruction: 'x' });
      const listed = await memories.listForFlow(flowId, ownerId);
      expect(listed.map((m) => m.id).slice(0, 2)).toEqual([newer.id, older.id]);
      expect(listed.every((m) => m.ownerId === ownerId)).toBe(true);

      expect(await memories.update(older.id, flowId, otherId, { title: 'hijack' })).toBeNull();
      expect(await memories.update(older.id, otherFlowId, ownerId, { title: 'x' })).toBeNull();
      const updated = await memories.update(older.id, flowId, ownerId, { status: 'active', title: null as never, nodeId: 'n1' });
      expect(updated).toMatchObject({ status: 'active', title: 'older', nodeId: 'n1' });
      expect((await memories.listForFlow(flowId, ownerId))[0].id).toBe(older.id);
      expect(await memories.update('bad', flowId, ownerId, {})).toBeNull();

      expect(await memories.delete(newer.id, flowId, otherId)).toBe(false);
      expect(await memories.delete(newer.id, flowId, ownerId)).toBe(true);
      expect(await memories.delete(newer.id, flowId, ownerId)).toBe(false);
    });

    it('finds the flow\'s active memories for the workflow or the given nodes, and counts those of a run', async () => {
      const f = otherFlowId;
      const make = (nodeId: string | null, status: string, createdFromExecutionId?: string) =>
        memories.create({ ownerId: otherId, flowId: f, nodeId, status, title: 't', content: 'c', normalizedInstruction: 'n', createdFromExecutionId });
      const workflow = await make(null, 'active', 'run-1');
      const nodeA = await make('a', 'active', 'run-1');
      await make('b', 'active', 'run-1');
      await make('a', 'draft', 'run-1');
      await make(null, 'active', 'run-2');
      const found = await memories.listActiveForNodes(f, ['a']);
      expect(found.map((m) => m.id).slice(0, 2)).toEqual([workflow.id, nodeA.id]);
      expect(found.map((m) => m.nodeId).sort()).toEqual([null, null, 'a'].sort());
      expect((await memories.listActiveForNodes(f, [])).every((m) => m.nodeId === null)).toBe(true);
      expect(await memories.countActiveFromExecution(f, 'a', 'run-1')).toBe(2);
      expect(await memories.countActiveFromExecution(f, 'b', 'run-1')).toBe(2);
      expect(await memories.countActiveFromExecution(f, 'z', 'run-2')).toBe(1);
      expect(await memories.listActiveForNodes('bad', ['a'])).toEqual([]);
    });
  });

  describe('mail event ledger', () => {
    const event = (over: Partial<NewMailEventLedger> = {}): NewMailEventLedger => ({
      ledgerId: `l-${oid()}`, flowId, dedupeKey: `m365:microsoft:${oid()}`, status: 'normalized', provider: 'm365', mailboxAppKey: 'microsoft',
      providerMessageId: 'msg', providerThreadId: null, receivedAt: new Date('2026-09-24T08:00:00Z'), occurredAt: new Date('2026-09-24T08:00:00Z'),
      subject: 'Invoice', bodyText: 'Body\u0000', bodyHtml: null, from: { name: 'A', address: 'a@x.io', extra: 1 } as never,
      to: [{ address: 'b@x.io' } as never], cc: [], hasAttachments: false, attachments: [], error: null, createdAt: new Date('2026-09-24T08:00:01Z'), ...over,
    });

    it('records an event once per dedupe key, also under concurrency, and casts the participants', async () => {
      const input = event();
      const results = await Promise.all([ledger.insertIfNew(input), ledger.insertIfNew({ ...input, ledgerId: `l-${oid()}` })]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const stored = await ledger.findByDedupeKey(flowId, input.dedupeKey);
      expect(stored).toMatchObject({ flowId, status: 'normalized', bodyText: 'Body', executionId: null, from: { name: 'A', address: 'a@x.io' }, to: [{ name: null, address: 'b@x.io' }] });
      expect(stored!.from).not.toHaveProperty('extra');
      expect(await ledger.insertIfNew(input)).toBeNull();
      // Another flow may see the same message.
      expect(await ledger.insertIfNew({ ...input, flowId: otherFlowId, ledgerId: `l-${oid()}` })).not.toBeNull();
      const error = await ledger.insertIfNew(event({ flowId: oid() })).catch((e: unknown) => e);
      expect(isForeignKeyViolation(error)).toBe(true);
      await expect(ledger.insertIfNew(event({ flowId: 'flow-1' }))).rejects.toThrow(/24-char hex/);
      expect(await ledger.findByDedupeKey('flow-1', input.dedupeKey)).toBeNull();
    });

    it('addresses an entry by its ledger id: status, attachments, and a hand-off that only one caller wins', async () => {
      const entry = (await ledger.insertIfNew(event()))!;
      expect(await ledger.findByLedgerId(entry.ledgerId, otherFlowId)).toBeNull();
      expect(await ledger.setStatus(entry.ledgerId, 'matched', null)).toBe(true);
      expect(await ledger.setAttachments(entry.ledgerId, [{ providerAttachmentId: 'a1', filename: 'cv.pdf', mimeType: null, size: 3, isInline: false, workspaceImport: { filename: 'cv.pdf' } as never }])).toBe(true);
      expect((await ledger.findByLedgerId(entry.ledgerId, flowId))?.attachments).toEqual([{
        providerAttachmentId: 'a1', filename: 'cv.pdf', mimeType: null, size: 3, isInline: false,
        workspaceImport: { workspaceDocumentId: null, filename: 'cv.pdf', finalFilename: null, mimeType: null, size: null, sourcePath: null, collisionResolved: false, error: null },
      }]);

      const executionId = oid();
      const outcomes = await Promise.all([ledger.markHandedOff(entry.ledgerId, executionId), ledger.markHandedOff(entry.ledgerId, oid())]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const after = await ledger.findByLedgerId(entry.ledgerId, flowId);
      expect(after).toMatchObject({ status: 'handed_off', error: null });
      expect(after!.executionId).toMatch(/^[0-9a-f]{24}$/);
      expect(await ledger.markHandedOff(entry.ledgerId, executionId)).toBe(false);
      expect(await ledger.setStatus(`l-${oid()}`, 'ignored', 'from')).toBe(false);
    });
  });
});
