import { eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { isUniqueViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import * as u from '../../../scripts/migrate/2026-10-playbook-assistant.units';
import type { PlaybookAssistantRefs, Row } from '../../../scripts/migrate/2026-10-playbook-assistant.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';

/**
 * The dev data holds almost no assistant rows (they live 24 hours to 30 days) and no design operation,
 * so the backfill would leave most of the mapping unexercised. This drives the same mapping,
 * validation and insert with fabricated Mongo-shaped documents and checks every migrated row reads
 * back identical (bigints read as float8, exactly as the runner's checksum does).
 */
describeIntegration('playbook assistant backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const oid = (): string => newObjectId();
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);
  const at = (iso: string): Date => new Date(iso);
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const ownerId = oid();
  const flowId = oid();
  const goneFlowId = oid();
  const goneUserId = oid();
  // Assistant rows key their owner by string: every one of them carries this owner.
  const assistantOwner = `bf-${ownerId}`;
  const stamp = { createdAt: at('2026-03-01T09:00:00Z'), updatedAt: at('2026-03-01T09:30:00Z') };

  const refs = (over: Partial<Record<keyof PlaybookAssistantRefs, string[]>> = {}): PlaybookAssistantRefs => ({
    users: new Set(over.users ?? [ownerId]),
    flows: new Set(over.flows ?? [flowId]),
    designMessages: new Set(over.designMessages ?? []),
  });

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `pb-bf-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    await db.insert(schema.playbookFlows).values({ id: flowId, ownerId, name: `backfill ${flowId}` });
  });

  afterAll(async () => {
    await db.delete(schema.playbookAssistantRequests).where(eq(schema.playbookAssistantRequests.ownerId, assistantOwner));
    await db.delete(schema.playbookAssistantOperations).where(eq(schema.playbookAssistantOperations.ownerId, assistantOwner));
    await db.delete(schema.playbookAssistantMessages).where(eq(schema.playbookAssistantMessages.ownerId, assistantOwner));
    await db.delete(schema.playbookAssistantRevisions).where(eq(schema.playbookAssistantRevisions.ownerId, assistantOwner));
    await db.delete(schema.playbookAssistantAttachments).where(eq(schema.playbookAssistantAttachments.ownerId, assistantOwner));
    // The user takes its flow, and the flow its design messages and operations.
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId]));
    await close();
  });

  const readBack = async (table: string, columns: string[], id: unknown): Promise<Row> => {
    const back = await pool.query(`SELECT ${u.checksumSelect(columns)} FROM ${table} WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const sameContent = (row: Row, back: Row) =>
    expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 });
  const roundTrip = async (table: string, columns: string[], row: Row): Promise<void> => {
    await u.insertRow(pool, table, columns, row);
    sameContent(row, await readBack(table, columns, row.id));
  };

  describe('assistant requests', () => {
    const requestDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: new Types.ObjectId(), requestId: `platform-generation:${oid()}`, ownerId: assistantOwner, agentId: 'agent-1', conversationId: 'conversation-1',
      correlationId: 'ai-message-1', operationKind: 'generation', playbookId: null, expectedDefinitionRevision: null, contextId: 'context-1',
      messageHash: 'hash', originalText: 'Build a lead\u0000 pipeline', requestedName: 'Leads',
      handoffContext: { summary: 'From the chat', sources: [{ workspaceId: objectId(flowId), addedAt: at('2026-02-01T00:00:00Z') }] },
      handoffProvenance: { handoffId: 'h-1', handoffVersion: 1, acceptedAt: '2026-02-01T00:00:00.000Z' },
      workspaceDefaultIds: [flowId], selectedTaskId: null, executionId: null, attachmentIds: [], continuationId: 'continuation-1',
      assessment: { status: 'needs_clarification', questions: [{ id: 'q1', text: 'Which region?' }] }, assessmentVersion: 2,
      answers: [{ questionId: 'q1', choice: 'France' }], mutationOperationId: null, assistantAnswer: null, responsePayload: null,
      status: 'awaiting_clarification', expiresAt: future, ...stamp, __v: 0, ...over,
    });

    it('maps a request with its handoff, assessment and answers and reads it back identical', async () => {
      const row = u.buildRequest(requestDoc());
      expect(row).toMatchObject({
        original_text: 'Build a lead pipeline',
        handoff_context: { summary: 'From the chat', sources: [{ workspaceId: flowId, addedAt: '2026-02-01T00:00:00.000Z' }] },
        workspace_default_ids: [flowId],
        assessment_version: 2,
      });
      expect(u.validateRequest(row)).toBeNull();
      await roundTrip('playbook.assistant_requests', u.REQUEST_COLUMNS, row);
      // Idempotent: a second run is a no-op.
      await u.insertRow(pool, 'playbook.assistant_requests', u.REQUEST_COLUMNS, row);
    });

    it('rejects what the schema cannot hold and reports a request id held by another row', async () => {
      expect(u.validateRequest(u.buildRequest(requestDoc({ operationKind: 'rewrite' })))).toMatch(/operation_kind 'rewrite'/);
      expect(u.validateRequest(u.buildRequest(requestDoc({ status: 'lost' })))).toMatch(/status 'lost'/);
      expect(u.validateRequest(u.buildRequest(requestDoc({ originalText: '' })))).toMatch(/original_text is empty/);
      expect(u.validateRequest(u.buildRequest(requestDoc({ expectedDefinitionRevision: -1 })))).toMatch(/expected_definition_revision -1/);
      expect(() => u.buildRequest(requestDoc({ expiresAt: undefined }))).toThrow(BackfillError);

      const first = u.buildRequest(requestDoc());
      await u.insertRow(pool, 'playbook.assistant_requests', u.REQUEST_COLUMNS, first);
      const twin = u.buildRequest(requestDoc({ requestId: first.request_id }));
      const error = await u.insertRow(pool, 'playbook.assistant_requests', u.REQUEST_COLUMNS, twin).catch((e: unknown) => e);
      expect(isUniqueViolation(error, 'uq_playbook_assistant_requests_request')).toBe(true);
    });

    it('copies only the TTL rows that have not expired', () => {
      expect(u.TTL_COLLECTIONS).toEqual(['playbookassistantrequests', 'playbookassistantoperations', 'playbookassistantmessages', 'playbookassistantrevisions']);
      expect(u.TTL_COLLECTIONS).not.toContain('playbookassistantattachments');
      expect(u.NOT_MIGRATED).toEqual(['playbook_design_messages']);
    });
  });

  describe('assistant operations', () => {
    const operationDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: new Types.ObjectId(), operationId: `operation-${oid()}`, playbookId: flowId, ownerId: assistantOwner, requestId: 'request-1',
      operationKind: 'generation', origin: 'advisor', target: 'advisor_preview', applyTarget: 'new_playbook', disposition: 'applied', status: 'completed',
      baseDefinitionRevision: 3, lastSequence: 2, eventBytes: 240, workerId: 'worker-1', leaseExpiresAt: null, terminalAt: at('2026-03-01T09:20:00Z'),
      committedRevision: 1, committedAt: at('2026-03-01T09:25:00Z'), revertedRevision: null, revertedAt: null, createdPlaybookId: oid(), expiresAt: future,
      events: [
        { type: 'started', sequence: 1, createdAt: '2026-03-01T09:10:00.000Z', model: 'm', baseDefinitionRevision: 3 },
        { type: 'completed', sequence: 2, createdAt: '2026-03-01T09:20:00.000Z', model: 'm', finalSuggestionCount: 2, note: 'done\u0000' },
      ],
      ...stamp, ...over,
    });

    it('maps the event log and the dispositions and reads them back identical', async () => {
      const row = u.buildOperation(operationDoc());
      expect((row.events as Row[])[1]).toMatchObject({ note: 'done' });
      expect(u.validateOperation(row)).toBeNull();
      await roundTrip('playbook.assistant_operations', u.OPERATION_COLUMNS, row);
    });

    it('fills the Mongoose defaults and rejects values outside the enums', async () => {
      const row = u.buildOperation(operationDoc({ origin: undefined, target: undefined, applyTarget: undefined, disposition: undefined, events: undefined, eventBytes: undefined }));
      expect(row).toMatchObject({ origin: 'designer', target: 'canonical', apply_target: 'current_playbook', disposition: 'pending', events: [], event_bytes: 0 });
      await roundTrip('playbook.assistant_operations', u.OPERATION_COLUMNS, row);
      expect(u.validateOperation(u.buildOperation(operationDoc({ status: 'paused' })))).toMatch(/status 'paused'/);
      expect(u.validateOperation(u.buildOperation(operationDoc({ baseDefinitionRevision: undefined })))).toMatch(/base_definition_revision/);
      expect(u.validateOperation(u.buildOperation(operationDoc({ workerId: '' })))).toMatch(/worker_id is empty/);
    });
  });

  describe('assistant messages, revisions and attachments', () => {
    it('maps a message and rejects an unknown role', async () => {
      const doc = {
        _id: new Types.ObjectId(), messageId: `message-${oid()}`, requestId: `request-${oid()}`, conversationId: 'conversation-1', ownerId: assistantOwner,
        playbookId: flowId, role: 'assistant', content: 'Here is\u0000 the plan', operationId: null, expiresAt: future, ...stamp,
      };
      const row = u.buildMessage(doc);
      expect(row.content).toBe('Here is the plan');
      expect(u.validateMessage(row)).toBeNull();
      await roundTrip('playbook.assistant_messages', u.MESSAGE_COLUMNS, row);
      expect(u.validateMessage(u.buildMessage({ ...doc, role: 'system' }))).toMatch(/role 'system'/);
    });

    it('maps a revision without timestamps, dating it from its ObjectId', async () => {
      const id = new Types.ObjectId();
      const doc = {
        _id: id, operationId: `operation-${oid()}`, playbookId: flowId, ownerId: assistantOwner, definitionRevision: 4,
        definition: { name: 'Before', nodes: [{ id: 'n1', metadata: { positionX: 1.5 } }], settings: { recursionLimit: 25 } }, expiresAt: future,
      };
      const row = u.buildRevision(doc);
      expect(row.created_at).toEqual(id.getTimestamp());
      expect(row.updated_at).toEqual(id.getTimestamp());
      expect(u.validateRevision(row)).toBeNull();
      await roundTrip('playbook.assistant_revisions', u.REVISION_COLUMNS, row);
      expect(() => u.buildRevision({ ...doc, _id: new Types.ObjectId(), definition: 'not a document' })).toThrow(BackfillError);
    });

    it('maps an attachment, expired or not, with its sizes read back as numbers', async () => {
      const doc = {
        _id: new Types.ObjectId(), attachmentId: `attachment-${oid()}`, requestId: 'request-1', ownerId: assistantOwner, playbookId: flowId,
        expectedDefinitionRevision: 3, objectKey: `playbook-assistant/${assistantOwner}/a.png`, mediaType: 'image/png', declaredSize: 1_400_000,
        actualSize: 1_400_000, contentSha256: 'sha', status: 'confirmed', expiresAt: at('2026-01-01T00:00:00Z'), ...stamp,
      };
      const row = u.buildAttachment(doc);
      expect(u.validateAttachment(row)).toBeNull();
      await roundTrip('playbook.assistant_attachments', u.ATTACHMENT_COLUMNS, row);
      expect(u.validateAttachment(u.buildAttachment({ ...doc, declaredSize: 0 }))).toMatch(/declared_size 0/);
      expect(u.validateAttachment(u.buildAttachment({ ...doc, status: 'uploaded' }))).toMatch(/status 'uploaded'/);
    });
  });

  describe('design workspace', () => {
    const messageDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: new Types.ObjectId(), flowId: objectId(flowId), createdBy: objectId(ownerId), userQuery: 'Add a review step', aiSummary: 'Added one step',
      snapshotBefore: { nodes: [{ id: 'n1', kind: 'step', label: 'Draft\u0000', metadata: { positionX: -146, positionY: -17.727272727272734 } }], controlEdges: [], dataBindings: [] },
      status: 'completed', revertedFromMessageId: null, error: null, ...stamp, __v: 0, ...over,
    });

    it('maps a design message and its snapshot and reads it back identical', async () => {
      const row = u.buildDesignMessage(messageDoc());
      expect(row.snapshot_before).toEqual({
        nodes: [{ id: 'n1', kind: 'step', label: 'Draft', metadata: { positionX: -146, positionY: -17.727272727272734 } }],
        controlEdges: [],
        dataBindings: [],
      });
      expect(u.validateDesignMessage(row, refs())).toBeNull();
      await roundTrip('playbook.design_messages', u.DESIGN_MESSAGE_COLUMNS, row);
    });

    it('defaults the missing snapshot arrays like the Mongoose subdocument did', () => {
      const row = u.buildDesignMessage(messageDoc({ snapshotBefore: { nodes: [{ id: 'n1' }] }, aiSummary: undefined }));
      expect(row).toMatchObject({ snapshot_before: { nodes: [{ id: 'n1' }], controlEdges: [], dataBindings: [] }, ai_summary: '' });
    });

    it('reports a message of a flow that is gone and keeps a revert whose original is not migrated', async () => {
      expect(u.validateDesignMessage(u.buildDesignMessage(messageDoc({ flowId: objectId(goneFlowId) })), refs())).toMatch(/dangling flow_id .*flow gone from PG/);
      expect(u.validateDesignMessage(u.buildDesignMessage(messageDoc({ status: 'pending' })), refs())).toMatch(/status 'pending'/);

      const original = u.buildDesignMessage(messageDoc());
      const revert = u.buildDesignMessage(messageDoc({ status: 'reverted', revertedFromMessageId: objectId(String(original.id)), userQuery: `Reverted to snapshot from ${original.id}` }));
      const orphanRevert = u.buildDesignMessage(messageDoc({ status: 'reverted', revertedFromMessageId: new Types.ObjectId() }));
      const accepted = refs({ designMessages: [String(original.id)] });

      await u.insertRow(pool, 'playbook.design_messages', u.DESIGN_MESSAGE_COLUMNS, original);
      await roundTrip('playbook.design_messages', u.DESIGN_MESSAGE_COLUMNS, u.withLiveRevertedMessage(revert, accepted));
      const fixed = u.withLiveRevertedMessage(orphanRevert, accepted);
      expect(fixed.reverted_from_message_id).toBeNull();
      await roundTrip('playbook.design_messages', u.DESIGN_MESSAGE_COLUMNS, fixed);
    });

    it('maps a design operation, reports a gone flow or owner, and drops a gone applied message', async () => {
      const doc = {
        _id: new Types.ObjectId(), flowId: objectId(flowId), ownerId: objectId(ownerId), query: 'Add a review step', status: 'completed',
        idempotencyKey: 'key-1', startedAt: at('2026-03-01T09:01:00Z'), completedAt: at('2026-03-01T09:02:00Z'), error: null,
        snapshotBefore: { nodes: [], controlEdges: [], dataBindings: [], updatedAt: at('2026-03-01T08:00:00Z') },
        resultPreview: { flowId }, appliedMessageId: new Types.ObjectId(), lockVersion: 1, ...stamp,
      };
      const row = u.buildDesignOperation(doc);
      expect(row.snapshot_before).toEqual({ nodes: [], controlEdges: [], dataBindings: [], updatedAt: '2026-03-01T08:00:00.000Z' });
      expect(u.validateDesignOperation(row, refs())).toBeNull();
      const fixed = u.withLiveAppliedMessage(row, refs());
      expect(fixed.applied_message_id).toBeNull();
      await roundTrip('playbook.design_operations', u.DESIGN_OPERATION_COLUMNS, fixed);

      expect(u.validateDesignOperation(u.buildDesignOperation({ ...doc, flowId: objectId(goneFlowId) }), refs())).toMatch(/dangling flow_id/);
      expect(u.validateDesignOperation(u.buildDesignOperation({ ...doc, ownerId: objectId(goneUserId) }), refs())).toMatch(/dangling owner_id/);
      expect(u.validateDesignOperation(u.buildDesignOperation({ ...doc, status: 'paused' }), refs())).toMatch(/status 'paused'/);
      expect(u.buildDesignOperation({ ...doc, idempotencyKey: undefined }).idempotency_key).toBeNull();
      expect(() => u.buildDesignOperation({ ...doc, flowId: 'not-an-id' })).toThrow(BackfillError);
    });
  });
});
