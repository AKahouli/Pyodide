import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import * as u from '../../../scripts/migrate/2026-10-playbook-templates.units';
import type { Row, TemplateRefs } from '../../../scripts/migrate/2026-10-playbook-templates.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { NodeTemplateRepository } from './persistence/node-template.repository';
import { MailEventLedgerRepository } from './persistence/mail-event-ledger.repository';
import { OutputFormatRepository } from './persistence/output-format.repository';

/**
 * The dev data has 4 node templates, 28 prompts, 21 output formats, no HITL memory and 98 ledger
 * entries without attachments, so this drives the same mapping, validation and insert with fabricated
 * Mongo-shaped documents (legacy fields, subdocument ids, dangling flows and runs) and checks every
 * migrated row reads back identical, and reads through the repositories like a row they wrote.
 */
describeIntegration('playbook templates backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const oid = (): string => newObjectId();
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);
  const at = (iso: string): Date => new Date(iso);

  const ownerId = oid();
  const goneUserId = oid(); // never inserted
  const flowId = oid();
  const goneFlowId = oid(); // never inserted
  const run = `a2bf${oid().slice(-8)}`;
  const templateIds: string[] = [];
  const promptIds: string[] = [];

  const refs = (over: Partial<Record<keyof TemplateRefs, string[]>> = {}): TemplateRefs => ({
    users: new Set(over.users ?? [ownerId]),
    flows: new Set(over.flows ?? [flowId]),
  });
  const stamp = { createdAt: at('2026-03-01T09:00:00Z'), updatedAt: at('2026-03-01T09:30:00Z') };

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `a2-bf-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    await db.insert(schema.playbookFlows).values({ id: flowId, ownerId, name: `a2 backfill ${flowId}` });
  });

  afterAll(async () => {
    // The flow cascades to its output formats, memories and ledger entries.
    await db.delete(schema.playbookFlows).where(inArray(schema.playbookFlows.id, [flowId]));
    if (templateIds.length) await db.delete(schema.playbookNodeTemplates).where(inArray(schema.playbookNodeTemplates.id, templateIds));
    if (promptIds.length) await db.delete(schema.playbookPromptTemplates).where(inArray(schema.playbookPromptTemplates.id, promptIds));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId]));
    await close();
  });

  const readBack = async (table: string, columns: string[], id: unknown): Promise<Row> => {
    const back = await pool.query(`SELECT ${u.checksumSelect(columns)} FROM ${table} WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const roundTrip = async (table: string, columns: string[], row: Row): Promise<void> => {
    await u.insertRow(pool, table, columns, row);
    const back = await readBack(table, columns, row.id);
    expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 });
  };

  describe('templates', () => {
    const nodeTemplateDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: new Types.ObjectId(), key: `${run}-router`, type: 'router', executionMode: 'live', nodeType: 'router', title: 'Router', description: 'Route',
      icon: 'GitBranch', color: 'blue', category: 'analysis',
      inputPorts: [{ id: 'input-1', name: 'Input', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'retry', name: 'retry', artifactKind: 'text' }],
      promptTemplate: 'p\u0000', recommendedAgentTypeSlug: null, requiredToolNames: ['search'], assignedAgentId: 'agent-1', selectedAction: null,
      iteratorConfig: { source: '{{items}}', mode: 'item', batchSize: 10, itemVariable: 'item', outputVariable: 'out', errorStrategy: 'stop', _id: new Types.ObjectId() },
      routerConfig: { outputLabels: ['retry', '__error__'], maxIterations: 3, conditions: [{ _id: new Types.ObjectId(), label: 'retry', operator: 'equals', value: 1 }], defaultLabel: 'retry', _id: new Types.ObjectId() },
      humanApprovalConfig: null, enabled: true, version: 4, isBuiltIn: true, createdBy: objectId(ownerId), updatedBy: objectId(goneUserId), __v: 0, ...stamp, ...over,
    });

    it('maps a node template, drops the legacy fields and subdocument ids, and reads back identical', async () => {
      const row = u.buildNodeTemplate(nodeTemplateDoc());
      templateIds.push(String(row.id));
      expect(Object.keys(row)).toEqual(u.NODE_TEMPLATE_COLUMNS);
      expect(row).toMatchObject({
        node_type: 'router', prompt_template: 'p', retry_policy: null, human_approval_config: null, updated_by: goneUserId,
        iterator_config: { source: '{{items}}', mode: 'item', batchSize: 10, itemVariable: 'item', outputVariable: 'out', errorStrategy: 'stop' },
        router_config: { outputLabels: ['retry', '__error__'], maxIterations: 3, conditions: [{ label: 'retry', sourceNode: null, sourcePort: null, path: null, operator: 'equals', value: 1 }], defaultLabel: 'retry' },
      });
      expect(u.validateNodeTemplate(row)).toBeNull();
      await roundTrip('playbook.node_templates', u.NODE_TEMPLATE_COLUMNS, row);

      const read = await new NodeTemplateRepository(db as never).findById(String(row.id));
      expect(read).toMatchObject({ key: `${run}-router`, version: 4, isBuiltIn: true, requiredToolNames: ['search'], routerConfig: row.router_config, iteratorConfig: row.iterator_config });
    });

    it('rejects what the node template columns cannot hold, and defaults a missing node type', () => {
      const verdict = (over: Record<string, unknown>) => u.validateNodeTemplate(u.buildNodeTemplate(nodeTemplateDoc(over)));
      expect(verdict({ nodeType: 'loop' })).toMatch(/node_type 'loop'/);
      expect(verdict({ title: 'x'.repeat(161) })).toMatch(/title length 161 exceeds 160/);
      expect(verdict({ key: '  ' })).toMatch(/key is missing/);
      expect(verdict({ version: 0 })).toMatch(/version 0 is below 1/);
      expect(u.buildNodeTemplate(nodeTemplateDoc({ nodeType: undefined })).node_type).toBe('agent');
      expect(() => u.buildNodeTemplate(nodeTemplateDoc({ _id: 'nope' }))).toThrow(BackfillError);
    });

    it('refuses a second template with the same key without swallowing it', async () => {
      const twin = u.buildNodeTemplate(nodeTemplateDoc());
      await expect(u.insertRow(pool, 'playbook.node_templates', u.NODE_TEMPLATE_COLUMNS, twin)).rejects.toThrow(/uq_playbook_node_templates_key/);
    });

    it('maps a prompt template, with the built-in default and a null updater', async () => {
      const row = u.buildPromptTemplate({
        _id: new Types.ObjectId(), key: ` ${run}.intent `, title: 'Intent', category: 'intent', description: '', systemTemplate: 'sys', userTemplate: '',
        enabled: true, version: 18, createdBy: new Types.ObjectId(), updatedBy: null, __v: 0, ...stamp,
      });
      promptIds.push(String(row.id));
      expect(row).toMatchObject({ key: `${run}.intent`, is_built_in: true, updated_by: null, description: '' });
      expect(u.validatePromptTemplate(row)).toBeNull();
      await roundTrip('playbook.prompt_templates', u.PROMPT_TEMPLATE_COLUMNS, row);
      expect(u.validatePromptTemplate({ ...row, category: 'c'.repeat(81) })).toMatch(/category length 81/);
    });
  });

  describe('output formats', () => {
    const formatDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: new Types.ObjectId(), flowId: objectId(flowId), nodeId: 'task-1', createdBy: objectId(ownerId), sourceExecutionId: new Types.ObjectId(),
      sourceExecutionNumber: 1, templateVersion: 2, status: 'inactive', generationStatus: 'ready', generationError: null, sourceOutput: '# R', formatGuide: '# G',
      llmPromptTrace: [{ stage: 'guide', model: 'm', prompt: 'p', extra: 1 }], ...stamp, ...over,
    });

    it('maps a format whose source run is gone (a soft reference) and reads it through the repository', async () => {
      const row = u.buildOutputFormat(formatDoc());
      expect(row.llm_prompt_trace).toEqual([{ stage: 'guide', model: 'm', prompt: 'p', generatedOutput: null }]);
      expect(u.validateOutputFormat(row, refs())).toBeNull();
      await roundTrip('playbook.output_formats', u.OUTPUT_FORMAT_COLUMNS, row);
      expect(await new OutputFormatRepository(db as never).findById(String(row.id))).toMatchObject({ flowId, templateVersion: 2, status: 'inactive', sourceExecutionId: row.source_execution_id });
    });

    it('reports a format of a deleted flow, and one the columns cannot hold', () => {
      expect(u.validateOutputFormat(u.buildOutputFormat(formatDoc({ flowId: objectId(goneFlowId) })), refs())).toMatch(/dangling flow_id/);
      expect(u.validateOutputFormat(u.buildOutputFormat(formatDoc({ status: 'deleted' })), refs())).toMatch(/status 'deleted'/);
      expect(u.validateOutputFormat(u.buildOutputFormat(formatDoc({ templateVersion: undefined })), refs())).toMatch(/template_version is missing/);
      expect(() => u.buildOutputFormat(formatDoc({ createdBy: null }))).toThrow(BackfillError);
    });
  });

  describe('HITL memories', () => {
    it('maps a memory whose ids were stored as strings, with the schema defaults', async () => {
      const row = u.buildHitlMemory({ _id: new Types.ObjectId(), ownerId, flowId, title: 'T', content: 'C', normalizedInstruction: 'N', status: 'active', createdFromExecutionId: 'run-1', ...stamp });
      expect(row).toMatchObject({ memory_type: 'procedural', source: 'hitl_feedback', applies_to: 'workflow', sensitivity: 'normal', node_id: null, created_from_interrupt_id: null });
      expect(u.validateHitlMemory(row, refs())).toBeNull();
      await roundTrip('playbook.hitl_memories', u.HITL_MEMORY_COLUMNS, row);
      expect(u.validateHitlMemory({ ...row, owner_id: goneUserId }, refs())).toMatch(/dangling owner_id/);
      expect(u.validateHitlMemory({ ...row, flow_id: goneFlowId }, refs())).toMatch(/dangling flow_id/);
      expect(u.validateHitlMemory({ ...row, sensitivity: 'secret' }, refs())).toMatch(/sensitivity 'secret'/);
    });
  });

  describe('mail ledger', () => {
    const ledgerDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: new Types.ObjectId(), id: `CtEt7naGUX${oid().slice(-10)}`, flowId, dedupeKey: `m365:microsoft:${oid()}`, status: 'handed_off', provider: 'm365',
      mailboxAppKey: 'microsoft', providerMessageId: 'AAMk', providerThreadId: 'thread', receivedAt: at('2026-06-01T08:00:00Z'), occurredAt: at('2026-06-01T08:00:00Z'),
      subject: 'CV', bodyText: 'Hello', bodyHtml: '<p>Hello</p>', from: { name: 'Ann', address: 'ann@example.com' }, to: [{ name: null, address: 'hr@example.com' }], cc: [],
      hasAttachments: true, attachments: [{ providerAttachmentId: 'a1', filename: 'cv.pdf', mimeType: 'application/pdf', size: 1200, isInline: false,
        workspaceImport: { workspaceDocumentId: oid(), filename: 'cv.pdf', finalFilename: 'cv (1).pdf', mimeType: 'application/pdf', size: 1200, sourcePath: 'mail/cv (1).pdf', collisionResolved: true, error: null } }],
      error: null, executionId: oid(), createdAt: at('2026-06-01T08:00:01Z'), __v: 0, ...over,
    });

    it('maps the `id` field to ledger_id, keeps the gone execution, reads back identical and through the repository', async () => {
      const doc = ledgerDoc();
      const row = u.buildMailLedger(doc);
      expect(row).toMatchObject({ ledger_id: doc.id, flow_id: flowId, execution_id: doc.executionId });
      expect(u.validateMailLedger(row, refs())).toBeNull();
      await roundTrip('playbook.mail_event_ledgers', u.MAIL_LEDGER_COLUMNS, row);

      const read = await new MailEventLedgerRepository(db as never).findByLedgerId(String(doc.id), flowId);
      expect(read).toMatchObject({ id: row.id, status: 'handed_off', from: doc.from, to: doc.to, cc: [], attachments: doc.attachments, executionId: doc.executionId });
    });

    it('reports an entry of a gone flow or without its ledger id, and refuses a second entry for one message', async () => {
      expect(u.validateMailLedger(u.buildMailLedger(ledgerDoc({ flowId: goneFlowId })), refs())).toMatch(/dangling flow_id/);
      expect(u.validateMailLedger(u.buildMailLedger(ledgerDoc({ receivedAt: null })), refs())).toMatch(/received_at is missing/);
      expect(() => u.buildMailLedger(ledgerDoc({ id: undefined }))).toThrow(/ledger id/);
      expect(() => u.buildMailLedger(ledgerDoc({ from: null }))).toThrow(/from is missing/);

      const first = u.buildMailLedger(ledgerDoc({ executionId: null }));
      await u.insertRow(pool, 'playbook.mail_event_ledgers', u.MAIL_LEDGER_COLUMNS, first);
      const again = u.buildMailLedger(ledgerDoc({ dedupeKey: first.dedupe_key }));
      await expect(u.insertRow(pool, 'playbook.mail_event_ledgers', u.MAIL_LEDGER_COLUMNS, again)).rejects.toThrow(/uq_playbook_mail_event_ledgers_dedupe/);
    });

    it('is idempotent: inserting a migrated row again changes nothing', async () => {
      const row = u.buildMailLedger(ledgerDoc());
      await u.insertRow(pool, 'playbook.mail_event_ledgers', u.MAIL_LEDGER_COLUMNS, row);
      await u.insertRow(pool, 'playbook.mail_event_ledgers', u.MAIL_LEDGER_COLUMNS, row);
      const count = await pool.query('SELECT count(*)::int AS n FROM playbook.mail_event_ledgers WHERE id = $1', [row.id]);
      expect(count.rows[0].n).toBe(1);
    });
  });
});
