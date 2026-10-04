import { eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import type { Pool } from 'pg';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import * as u from '../../../scripts/migrate/2026-10-conversation-v1.units';
import { runConversationV1Backfill, type ConversationV1Result, type MongoSource, type PassKey, type PassReport } from '../../../scripts/migrate/2026-10-conversation-v1';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { PostgresConversationStore } from './persistence/postgres/postgres-conversation-store';
import { PostgresMessageStore } from './persistence/postgres/postgres-message-store';
import { PostgresReportStore } from './persistence/postgres/postgres-report-store';

/**
 * The legacy Conversation v1 history (Mongo conversations / messages / reports) is backfilled by
 * scripts/migrate/2026-10-conversation-v1.ts. The dev data has no governed conversation, no
 * over-long text and only a handful of group chats, so the mapping is driven here with fabricated
 * Mongo-shaped documents (never real content). The integration block runs the runner itself over
 * an in-memory Mongo source against the test database, then reads the rows back through the live
 * Postgres stores.
 */
const oid = (hex?: string): Types.ObjectId => new Types.ObjectId(hex);
const at = (iso: string): Date => new Date(iso);
const stamp = { createdAt: at('2026-03-01T09:00:00.000Z'), updatedAt: at('2026-03-01T09:30:00.000Z') };

describe('conversation v1 backfill mapping', () => {
  const owner = newObjectId();
  const member = newObjectId();
  const workspace = newObjectId();
  const goneWorkspace = newObjectId();
  const project = newObjectId();
  const refs = {
    users: new Set([owner, member]),
    workspaces: new Set([workspace]),
    projects: new Set([project]),
    conversations: new Set<string>(),
    messages: new Set<string>(),
  };

  describe('conversations', () => {
    it('maps a pre-runtime-mode conversation with the Mongoose defaults and copies the stored counters', () => {
      const doc = { _id: oid(), createdBy: oid(owner), messages: [oid(), oid()], workspaces: [], messageCount: 7, isArchived: true, isShared: false, isFirstMessage: false, __v: 0, ...stamp };
      const plan = u.mapConversation(doc);
      expect(plan.row).toMatchObject({
        runtime_mode: 'standard', runtime_purpose: 'chat', initialization_status: 'ready', title: 'New Conversation', created_by: owner,
        message_count: 7, last_message_at: null, is_archived: true, is_first_message: false, is_group: false, pinned_agent_id: null,
        branch_provenance: null, governance_context: null, created_at: stamp.createdAt, updated_at: stamp.updatedAt,
      });
      expect(plan.members).toEqual([]);
      expect(plan.anomalies).toEqual([]);
      expect(u.unmappedConversationPaths(doc)).toEqual(['messages', '__v']);
      expect(u.validateConversation(plan, refs)).toBeNull();
    });

    it('maps a governed conversation: ObjectIds become hex strings and dates ISO strings, as the live service writes them', () => {
      const programId = oid();
      const agent = oid();
      const plan = u.mapConversation({
        _id: oid(), createdBy: oid(owner), title: 'Governed', runtimeMode: 'governed', governedCreationRequestId: 'req-1', messageCount: 0, isFirstMessage: true,
        governanceContext: { programId, scopeId: oid(), deploymentId: oid(), revisionId: oid(), revisionNumber: 3, pinnedAt: at('2026-03-02T10:00:00.000Z'), runtimeDefinition: { primaryAgentId: String(agent), allowedAgentIds: [agent], workspaceIds: [] } },
        ...stamp,
      });
      expect(plan.row).toMatchObject({ runtime_mode: 'governed', governed_creation_request_id: 'req-1', is_first_message: true });
      expect(plan.row.governance_context).toMatchObject({ programId: String(programId), revisionNumber: 3, pinnedAt: '2026-03-02T10:00:00.000Z', runtimeDefinition: { primaryAgentId: String(agent), allowedAgentIds: [String(agent)], workspaceIds: [] } });
    });

    it('maps a platform-copilot conversation with its pinned agent and creation request', () => {
      const agent = oid();
      const plan = u.mapConversation({ _id: oid(), createdBy: oid(owner), title: 'Copilot', runtimePurpose: 'platform_copilot', pinnedAgentId: agent, platformCopilotCreationRequestId: 'pc-1', messageCount: 2, ...stamp });
      expect(plan.row).toMatchObject({ runtime_purpose: 'platform_copilot', pinned_agent_id: String(agent), platform_copilot_creation_request_id: 'pc-1' });
      expect(u.danglingKeptInConversation(plan, { users: refs.users, agents: new Set(), skills: new Set() })).toEqual(['conversations.pinned_agent_id']);
    });

    it('maps a group: is_group from groupMeta, members and invitations in order, a repeated member merged, sub-document ids unmapped', () => {
      const agent = oid();
      const doc = {
        _id: oid(), createdBy: oid(owner), title: 'Team', messageCount: 4, ...stamp,
        groupMeta: {
          _id: oid(), isGroup: true, taggedAgents: [agent], tasks: [],
          members: [
            { _id: oid(), userId: oid(owner), joinedAt: at('2026-03-01T09:00:00.000Z'), status: 'owner', mentions: [] },
            { _id: oid(), userId: oid(member), joinedAt: at('2026-03-01T09:05:00.000Z'), status: 'member', job: 'Analyst', mentions: [{ _id: oid(), messageId: oid(), seenAt: null, createdAt: at('2026-03-01T09:06:00.000Z') }] },
            { _id: oid(), userId: oid(member), joinedAt: at('2026-03-01T09:07:00.000Z'), status: 'member', mentions: [] },
          ],
          invitedUsers: [
            { _id: oid(), email: 'guest@example.com', status: 'Guest', invitedAt: at('2026-03-01T09:10:00.000Z') },
            { _id: oid(), email: 'confirmed@example.com', status: 'Confirmed', invitedAt: at('2026-03-01T09:11:00.000Z'), job: 'Lead' },
          ],
        },
      };
      const plan = u.mapConversation(doc);
      expect(plan.row.is_group).toBe(true);
      expect(plan.ordered.group_tagged_agents).toEqual([String(agent)]);
      expect(plan.members).toEqual([
        { user_id: owner, joined_at: at('2026-03-01T09:00:00.000Z'), status: 'owner', job: null },
        { user_id: member, joined_at: at('2026-03-01T09:05:00.000Z'), status: 'member', job: 'Analyst' },
      ]);
      expect(plan.anomalies).toEqual(['groupMeta.members[]: repeated member merged into its first entry']);
      expect(plan.invites).toEqual([
        { email: 'guest@example.com', normalized_email: 'guest@example.com', status: 'Guest', invited_at: at('2026-03-01T09:10:00.000Z'), job: null },
        { email: 'confirmed@example.com', normalized_email: 'confirmed@example.com', status: 'Confirmed', invited_at: at('2026-03-01T09:11:00.000Z'), job: 'Lead' },
      ]);
      expect(u.unmappedConversationPaths(doc).sort()).toEqual(['groupMeta._id', 'groupMeta.invitedUsers[]._id', 'groupMeta.members[]._id', 'groupMeta.members[].mentions[]._id', 'groupMeta.members[].mentions[].createdAt', 'groupMeta.tasks']);
    });

    it('numbers group mentions per user like the live addMention, and drops a mention whose message is not in Postgres', () => {
      const [m1, m2, m3] = [newObjectId(), newObjectId(), newObjectId()];
      const plan = u.mapMentions({
        _id: oid(),
        groupMeta: { members: [
          { userId: oid(member), mentions: [{ messageId: oid(m1), seenAt: at('2026-03-01T10:00:00.000Z') }, { messageId: oid(m2) }, { messageId: oid(m3) }] },
          { userId: oid(owner), mentions: [{ messageId: oid(m2) }] },
        ] },
      });
      expect(plan.rows.filter((r) => r.user_id === member).map((r) => r.position)).toEqual([0, 1, 2]);
      const live = u.withLiveMentionMessages(plan, new Set([m1, m3, m2].filter((id) => id !== m2)));
      expect(live.cleared).toEqual(['conversation_member_mentions.message_id (message not in Postgres)', 'conversation_member_mentions.message_id (message not in Postgres)']);
      expect(live.rows.filter((r) => r.user_id === member)).toEqual([
        { user_id: member, position: 0, message_id: m1, seen_at: at('2026-03-01T10:00:00.000Z') },
        { user_id: member, position: 1, message_id: m3, seen_at: null },
      ]);
    });

    it('keeps the branch provenance without its Mongoose _id and projects its request id', () => {
      const source = oid();
      const answer = oid();
      const plan = u.mapConversation({
        _id: oid(), createdBy: oid(owner), title: 'Branch', messageCount: 2, initializationStatus: 'ready', ...stamp,
        branchProvenance: { _id: oid(), sourceConversationId: source, sourceTargetMessageId: answer, requestId: 'br-1', requestFingerprint: 'fp', branchedBy: oid(owner), branchedAt: at('2026-03-03T08:00:00.000Z'), selectedAnswerIds: [answer] },
      });
      expect(plan.row.branch_request_id).toBe('br-1');
      expect(plan.row.branch_provenance).toEqual({
        sourceConversationId: String(source), sourceTargetMessageId: String(answer), requestId: 'br-1', requestFingerprint: 'fp', branchedBy: owner, branchedAt: '2026-03-03T08:00:00.000Z', selectedAnswerIds: [String(answer)],
      });
    });

    it('clears references a validated foreign key would reject, and counts each one', () => {
      const plan = u.withLiveReferences(u.mapConversation({
        _id: oid(), createdBy: oid(owner), title: 'Refs', messageCount: 1, systemWorkspaceId: oid(goneWorkspace), projectId: oid(), workspaces: [oid(goneWorkspace), oid(workspace)], ...stamp,
      }), refs);
      expect(plan.row).toMatchObject({ system_workspace_id: null, project_id: null });
      expect(plan.ordered.workspaces).toEqual([workspace]);
      expect(plan.cleared).toEqual([
        'conversations.system_workspace_id (workspace not in Postgres)',
        'conversations.project_id (project not in Postgres)',
        'conversation_workspaces.workspace_id (workspace not in Postgres)',
      ]);
      const kept = u.withLiveReferences(u.mapConversation({ _id: oid(), createdBy: oid(owner), messageCount: 0, projectId: oid(project), systemWorkspaceId: oid(workspace), ...stamp }), refs);
      expect(kept.row).toMatchObject({ project_id: project, system_workspace_id: workspace });
      expect(kept.cleared).toEqual([]);
    });

    it('skips what Postgres could not hold or the policy refuses, and says why without content', () => {
      const verdict = (over: Record<string, unknown>) => u.validateConversation(u.mapConversation({ _id: oid(), createdBy: oid(owner), title: 't', messageCount: 0, ...stamp, ...over }), refs);
      expect(verdict({ createdBy: oid() })).toBe('owner (createdBy) is not in identity.users');
      expect(verdict({ title: 'x'.repeat(200) })).toBeNull();
      expect(verdict({ title: 'x'.repeat(201) })).toBe('title longer than 200 characters');
      expect(verdict({ title: '😀'.repeat(200) })).toBeNull(); // 400 UTF-16 units, 200 characters
      expect(verdict({ runtimeMode: 'turbo' })).toMatch(/^runtimeMode value is not one of/);
      expect(verdict({ initializationStatus: 'lost' })).toMatch(/^initializationStatus/);
      expect(verdict({ messageCount: -1 })).toMatch(/^messageCount outside/);
      expect(verdict({ groupMeta: { isGroup: true, members: [{ userId: oid(member), joinedAt: stamp.createdAt, status: 'admin' }], invitedUsers: [] } })).toMatch(/members\[\]\.status/);
      expect(verdict({ groupMeta: { isGroup: true, members: [], invitedUsers: [{ email: 'a@b.c', status: 'Pending', invitedAt: stamp.createdAt }] } })).toMatch(/invitedUsers\[\]\.status/);
      expect(verdict({ groupMeta: { isGroup: true, members: [], invitedUsers: [{ email: `${'a'.repeat(320)}@b.c`, status: 'Guest', invitedAt: stamp.createdAt }] } })).toMatch(/email longer than 320/);
      expect(() => u.mapConversation({ _id: oid(), createdBy: 'nobody', ...stamp })).toThrow(BackfillError);
      expect(() => u.mapConversation({ _id: 'not-an-id', createdBy: oid(owner) })).toThrow(/_id is not a 24-char hex id/);
    });

    it('removes U+0000, records it, and derives missing timestamps and join dates instead of inventing now()', () => {
      const id = oid();
      const plan = u.mapConversation({ _id: id, createdBy: oid(owner), title: 'a\u0000b', groupMeta: { isGroup: true, members: [{ userId: oid(owner), status: 'owner' }], invitedUsers: [] } });
      expect(plan.row.title).toBe('ab');
      expect(plan.row.created_at).toEqual(id.getTimestamp());
      expect(plan.row.updated_at).toEqual(id.getTimestamp());
      expect(plan.members[0].joined_at).toEqual(id.getTimestamp());
      expect(plan.anomalies).toEqual(expect.arrayContaining(['title: NUL removed', 'createdAt missing: ObjectId time used', 'updatedAt missing: createdAt used', 'messageCount missing: 0 used', 'groupMeta.members[].joinedAt missing: conversation createdAt used']));
    });

    it('drops a malformed optional id and records it', () => {
      const plan = u.mapConversation({ _id: oid(), createdBy: oid(owner), messageCount: 0, pinnedAgentId: 'agent-x', taggedAgentIds: [oid(), 'junk'], ...stamp });
      expect(plan.row.pinned_agent_id).toBeNull();
      expect(plan.ordered.tagged_agents).toHaveLength(1);
      expect(plan.anomalies).toEqual(['pinnedAgentId: malformed id dropped', 'taggedAgentIds: malformed id dropped']);
    });
  });

  describe('messages', () => {
    const conversation = newObjectId();
    const messageRefs = { conversations: new Set([conversation]) };

    it('maps a user turn: arrays stay absent or empty as stored, the three self references are held back', () => {
      const question = oid();
      const file = oid();
      const doc = {
        _id: question, conversationId: oid(conversation), senderId: oid(owner), conversationType: 'user', content: 'hello', attachedFileIds: [file], agentIds: [], requestId: 'rq-1',
        parentMessageId: oid(), answerMessageId: oid(), webSearchEnabled: false, isEdited: true, editedAt: at('2026-03-01T09:01:00.000Z'), isStreaming: false, isComplete: true, taskMode: true, seenAt: null, __v: 0, ...stamp,
      };
      const plan = u.mapMessage(doc);
      expect(plan.row).toMatchObject({ sender_id: owner, conversation_type: 'user', content: 'hello', attached_file_ids: [String(file)], agent_ids: [], member_ids: null, components: null, request_id: 'rq-1', is_edited: true, is_complete: true, feedback: null });
      expect(Object.keys(plan.row)).toEqual(u.MESSAGE_COLUMNS);
      expect(plan.links).toEqual({ parent_message_id: String(doc.parentMessageId), question_message_id: null, answer_message_id: String(doc.answerMessageId) });
      expect(u.unmappedMessagePaths(doc)).toEqual(['taskMode', 'seenAt', '__v']);
      expect(u.validateMessage(plan, messageRefs)).toBeNull();
      expect(u.danglingKeptInMessage(plan, { users: new Set([owner]), agents: new Set(), documents: new Set() })).toEqual(['messages.attached_file_ids[]']);
    });

    it('maps an AI turn: components, interactions, telemetry, reliability and feedback as jsonb, NUL removed', () => {
      const sourceMessage = oid();
      const plan = u.mapMessage({
        _id: oid(), conversationId: oid(conversation), conversationType: 'ai', questionMessageId: oid(), modelId: 'model-x', reasoningEffort: 'low',
        components: [{ id: 'c1', type: 'text', data: { content: 'a\u0000b' } }, { type: 'citation', data: { sourceId: sourceMessage, at: at('2026-03-01T09:02:00.000Z') } }],
        interaction: { kind: 'choice', sourceMessageId: sourceMessage }, interactions: [{ kind: 'choice', answeredAt: at('2026-03-01T09:03:00.000Z') }],
        modelRequestTelemetry: { usedTokens: 10, contextWindow: 100, model: 'model-x' }, inputTokens: 12, outputTokens: 34, durationMs: 1500.7, timeToFirstChunk: 20, timeToFirstToken: 30,
        guardrailDecision: { action: 'allow' }, replayContext: { seed: 1 }, reliabilityEvaluation: { status: 'completed', requestedAt: '2026-03-01T09:04:00.000Z' }, correctionWorkflow: { status: 'idle' },
        reliabilityEvaluationHeartbeatAt: at('2026-03-01T09:05:00.000Z'), feedback: 'like', feedbackAt: at('2026-03-01T09:06:00.000Z'), streamExecutionLeaseId: 'lease', streamExecutionLeaseExpiresAt: at('2026-03-01T09:07:00.000Z'),
        isStreaming: false, isComplete: true, ...stamp,
      });
      expect(plan.row.components).toEqual([{ id: 'c1', type: 'text', data: { content: 'ab' } }, { type: 'citation', data: { sourceId: String(sourceMessage), at: '2026-03-01T09:02:00.000Z' } }]);
      expect(plan.row).toMatchObject({
        interaction: { kind: 'choice', sourceMessageId: String(sourceMessage) }, interactions: [{ kind: 'choice', answeredAt: '2026-03-01T09:03:00.000Z' }],
        model_request_telemetry: { usedTokens: 10, contextWindow: 100, model: 'model-x' }, duration_ms: 1500, feedback: 'like', stream_execution_lease_id: 'lease', latency_metrics: null,
      });
      expect(plan.anomalies).toEqual(['components: NUL removed', 'durationMs: fraction truncated']);
      expect(plan.links.question_message_id).not.toBeNull();
      expect(plan.bytes).toBeGreaterThan(0);
      expect(u.validateMessage(plan, messageRefs)).toBeNull();
    });

    it('skips a message whose conversation was skipped (with that reason) or is missing, and what the checks would refuse', () => {
      const skipped = newObjectId();
      const verdict = (over: Record<string, unknown>) => u.validateMessage(u.mapMessage({ _id: oid(), conversationId: oid(conversation), conversationType: 'user', content: 'x', ...stamp, ...over }), messageRefs, new Map([[skipped, 'owner (createdBy) is not in identity.users']]));
      expect(verdict({ conversationId: oid(skipped) })).toBe('conversation skipped: owner (createdBy) is not in identity.users');
      expect(verdict({ conversationId: oid() })).toMatch(/^conversation is not in Postgres/);
      expect(verdict({ content: 'x'.repeat(50001) })).toBe('content longer than 50000 characters');
      expect(verdict({ content: 'x'.repeat(50000) })).toBeNull();
      expect(verdict({ conversationType: 'bot' })).toMatch(/^conversationType/);
      expect(verdict({ feedback: 'meh' })).toMatch(/^feedback/);
      expect(verdict({ modelId: 'm'.repeat(101) })).toBe('modelId longer than 100 characters');
      expect(verdict({ inputTokens: -1 })).toMatch(/^input_tokens outside/);
      expect(verdict({ outputTokens: 2 ** 31 })).toMatch(/^output_tokens outside/);
      expect(() => u.mapMessage({ _id: oid(), conversationType: 'user' })).toThrow(/conversationId/);
    });

    it('nulls a self reference to a message that is not in Postgres, and knows when the links are already in place', () => {
      const [parent, question, answer] = [newObjectId(), newObjectId(), newObjectId()];
      const id = newObjectId();
      const plan = u.withLiveLinkTargets(u.mapMessageLinks({ _id: oid(id), parentMessageId: oid(parent), questionMessageId: oid(question), answerMessageId: oid(answer) }), new Set([parent, answer]));
      expect(plan.row).toEqual({ id, parent_message_id: parent, question_message_id: null, answer_message_id: answer });
      expect(plan.cleared).toEqual(['messages.question_message_id (message not in Postgres)']);
      expect(u.linksInPlace(plan, { id, parent_message_id: null, question_message_id: null, answer_message_id: answer })).toBe(false);
      expect(u.linksInPlace(plan, { id, parent_message_id: parent, question_message_id: null, answer_message_id: answer })).toBe(true);
      expect(u.linksInPlace(plan, undefined)).toBe(false);
    });

    it('checksums text and payloads by digest: key order does not matter, content does', () => {
      const plan = u.mapMessage({ _id: oid(), conversationId: oid(conversation), conversationType: 'ai', components: [{ type: 'text', data: { a: 1, b: [1, 2] } }], ...stamp });
      const readBack = { ...plan.row, components: [{ data: { b: [1, 2], a: 1 }, type: 'text' }], id: `${plan.row.id}` };
      expect(u.messageUnit(plan.row)).toEqual(u.messageUnit(readBack));
      expect(u.messageUnit(plan.row).components).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(u.messageUnit(plan.row).content).toBeNull();
      expect(u.messageUnit({ ...readBack, components: [{ type: 'text', data: { a: 2, b: [1, 2] } }] }).components).not.toEqual(u.messageUnit(plan.row).components);
    });
  });

  describe('reports', () => {
    it('maps a report with the Mongoose defaults and keeps its weak references as they are', () => {
      const plan = u.mapReport({ _id: oid(), conversationId: oid(), messageId: oid(), userId: oid(owner), reason: 'offensive', description: 'd', status: 'pending', __v: 0, ...stamp });
      expect(plan.row).toMatchObject({ source: 'user', status: 'pending', admin_notes: null, reason: 'offensive' });
      expect(u.validateReport(plan)).toBeNull();
      expect(u.danglingKeptInReport(plan, { users: new Set([owner]), conversations: new Set(), messages: new Set() })).toEqual(['reports.conversation_id', 'reports.message_id']);
      expect(u.unmappedReportPaths({ _id: oid(), __v: 0, extra: 1 })).toEqual(['__v', 'extra']);
    });

    it('refuses what the report checks would reject', () => {
      const verdict = (over: Record<string, unknown>) => u.validateReport(u.mapReport({ _id: oid(), conversationId: oid(), messageId: oid(), userId: oid(), reason: 'other', description: 'd', ...stamp, ...over }));
      expect(verdict({ reason: 'boring' })).toMatch(/^reason/);
      expect(verdict({ source: 'robot' })).toMatch(/^source/);
      expect(verdict({ status: 'archived' })).toMatch(/^status/);
      expect(verdict({ description: 'x'.repeat(2001) })).toBe('description longer than 2000 characters');
      expect(verdict({ adminNotes: 'x'.repeat(2001) })).toBe('adminNotes longer than 2000 characters');
    });
  });
});

/** Just enough of a Mongo collection for the harness: filter ($or, $ne null, $exists, dotted paths), _id order, count. */
function fakeMongo(collections: Record<string, Record<string, unknown>[]>): MongoSource {
  const valuesAt = (value: unknown, parts: string[]): unknown[] => {
    if (!parts.length) return [value];
    if (value === null || value === undefined || typeof value !== 'object') return [];
    const [head, ...rest] = parts;
    if (Array.isArray(value)) return /^\d+$/.test(head) ? valuesAt(value[Number(head)], rest) : value.flatMap((item) => valuesAt(item, parts));
    return valuesAt((value as Record<string, unknown>)[head], rest);
  };
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([key, condition]) => {
      if (key === '$or') return (condition as Record<string, unknown>[]).some((f) => matches(doc, f));
      if (key === '$and') return (condition as Record<string, unknown>[]).every((f) => matches(doc, f));
      const values = valuesAt(doc, key.split('.')).filter((v) => v !== undefined);
      const c = condition as Record<string, unknown>;
      if ('$exists' in c) return values.length > 0 === c.$exists;
      if ('$ne' in c && c.$ne === null) return values.some((v) => v !== null);
      throw new Error(`fake Mongo: unsupported filter on ${key}`);
    });
  return {
    collection: (name: string) => {
      const docs = collections[name] ?? [];
      const select = (filter: Record<string, unknown> = {}) => docs.filter((doc) => matches(doc, filter)).sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1));
      return {
        collectionName: name,
        countDocuments: async (filter?: Record<string, unknown>) => select(filter).length,
        find: (filter?: Record<string, unknown>) => {
          const cursor = {
            sort: () => cursor,
            async *[Symbol.asyncIterator]() {
              for (const doc of select(filter)) yield doc;
            },
          };
          return cursor;
        },
      } as unknown as ReturnType<MongoSource['collection']>;
    },
  };
}

describeIntegration('conversation v1 backfill runner (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const conversations = new PostgresConversationStore(db);
  const messages = new PostgresMessageStore(db);
  const reports = new PostgresReportStore(db);

  const owner = newObjectId();
  const member = newObjectId();
  const goneUser = newObjectId(); // never inserted
  const workspace = newObjectId();
  const goneWorkspace = newObjectId();
  const project = newObjectId();
  const [groupId, governedId, orphanId, strayConversationId] = [newObjectId(), newObjectId(), newObjectId(), newObjectId()];
  const [m1, m2, m3, orphanMessage, strayMessage, goneMessage] = [newObjectId(), newObjectId(), newObjectId(), newObjectId(), newObjectId(), newObjectId()];
  const [report1, report2] = [newObjectId(), newObjectId()];
  const agent = newObjectId();

  const source = fakeMongo({
    conversations: [
      {
        _id: oid(groupId), title: 'Team \u0000room', createdBy: oid(owner), messages: [oid(m1), oid(m2), oid(m3)], workspaces: [oid(workspace), oid(goneWorkspace)], selectedSkills: [oid()],
        taggedAgentIds: [oid(agent)], systemWorkspaceId: oid(goneWorkspace), projectId: oid(project), messageCount: 5, lastMessageAt: at('2026-03-01T10:00:00.000Z'),
        isArchived: false, isShared: false, isFirstMessage: false, runtimeMode: 'standard', initializationStatus: 'ready', __v: 3, ...stamp,
        branchProvenance: { _id: oid(), sourceConversationId: oid(governedId), sourceTargetMessageId: oid(m2), requestId: `br-${groupId}`, requestFingerprint: 'fp', branchedBy: oid(owner), branchedAt: at('2026-03-01T08:00:00.000Z'), selectedAnswerIds: [oid(m2)] },
        groupMeta: {
          _id: oid(), isGroup: true, taggedAgents: [oid(agent)],
          members: [
            { _id: oid(), userId: oid(owner), joinedAt: stamp.createdAt, status: 'owner', mentions: [{ _id: oid(), messageId: oid(m3), seenAt: at('2026-03-01T09:40:00.000Z') }] },
            { _id: oid(), userId: oid(member), joinedAt: at('2026-03-01T09:05:00.000Z'), status: 'member', job: 'Analyst', mentions: [{ _id: oid(), messageId: oid(goneMessage) }, { _id: oid(), messageId: oid(m2) }] },
          ],
          invitedUsers: [{ _id: oid(), email: `guest-${groupId}@example.com`, status: 'Guest', invitedAt: at('2026-03-01T09:10:00.000Z') }],
        },
      },
      {
        _id: oid(governedId), title: 'Governed', createdBy: oid(owner), messages: [], workspaces: [], messageCount: 0, isArchived: true, isShared: false, isFirstMessage: true, runtimeMode: 'governed',
        governedCreationRequestId: `gov-${governedId}`, ...stamp,
        governanceContext: { programId: oid(), scopeId: oid(), deploymentId: oid(), revisionId: oid(), revisionNumber: 2, pinnedAt: at('2026-03-01T08:30:00.000Z'), runtimeDefinition: { primaryAgentId: agent, allowedAgentIds: [agent], workspaceIds: [workspace] } },
      },
      { _id: oid(orphanId), title: 'Orphan', createdBy: oid(goneUser), messages: [oid(orphanMessage)], workspaces: [], messageCount: 1, isArchived: false, isShared: false, isFirstMessage: false, ...stamp },
    ],
    messages: [
      { _id: oid(m1), conversationId: oid(groupId), senderId: oid(owner), conversationType: 'user', content: 'question \u0000one', requestId: `rq-${m1}`, answerMessageId: oid(m2), agentIds: [oid(agent)], webSearchEnabled: false, isEdited: false, isStreaming: false, isComplete: true, __v: 0, createdAt: at('2026-03-01T09:10:00.000Z'), updatedAt: at('2026-03-01T09:10:00.000Z') },
      {
        _id: oid(m2), conversationId: oid(groupId), conversationType: 'ai', questionMessageId: oid(m1), requestId: `rq-${m1}`, modelId: 'model-x', components: [{ id: 'c1', type: 'text', data: { content: 'answer', ref: oid(m1), at: at('2026-03-01T09:11:00.000Z') } }],
        inputTokens: 10, outputTokens: 20, durationMs: 300, feedback: 'dislike', feedbackAt: at('2026-03-01T09:12:00.000Z'), reliabilityEvaluation: { status: 'completed' }, webSearchEnabled: false, isEdited: false, isStreaming: false, isComplete: true, __v: 0,
        createdAt: at('2026-03-01T09:11:00.000Z'), updatedAt: at('2026-03-01T09:11:30.000Z'),
      },
      { _id: oid(m3), conversationId: oid(groupId), senderId: oid(member), conversationType: 'user', content: 'follow-up', parentMessageId: oid(m1), questionMessageId: oid(goneMessage), memberIds: [oid(owner)], webSearchEnabled: false, isEdited: false, isStreaming: false, isComplete: true, __v: 0, createdAt: at('2026-03-01T09:20:00.000Z'), updatedAt: at('2026-03-01T09:20:00.000Z') },
      { _id: oid(orphanMessage), conversationId: oid(orphanId), conversationType: 'user', content: 'x', answerMessageId: oid(m2), webSearchEnabled: false, isEdited: false, isStreaming: false, isComplete: true, ...stamp },
      { _id: oid(strayMessage), conversationId: oid(strayConversationId), conversationType: 'user', content: 'x', webSearchEnabled: false, isEdited: false, isStreaming: false, isComplete: true, ...stamp },
    ],
    reports: [
      { _id: oid(report1), conversationId: oid(groupId), messageId: oid(m2), userId: oid(member), reason: 'wrong_information', description: 'wrong', status: 'pending', __v: 0, ...stamp },
      { _id: oid(report2), conversationId: oid(strayConversationId), messageId: oid(strayMessage), userId: oid(owner), reason: 'other', description: 'gone', status: 'resolved', adminNotes: 'done', source: 'user', __v: 0, ...stamp },
    ],
  });

  const argv = process.argv;
  let first: ConversationV1Result;
  let second: ConversationV1Result;
  const pass = (result: ConversationV1Result, key: PassKey): PassReport => result.passes.find((p) => p.pass === key)!;

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values([owner, member].map((id) => ({ id, email: `cv1-bf-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' })));
    await db.insert(schema.workspaces).values({ id: workspace, name: `cv1 bf ${workspace}`, alias: `cv1-bf-${workspace}`, storagePrefix: `cv1-bf-${workspace}`, createdBy: owner, allocatedStorage: 1 });
    await db.insert(schema.projects).values({ id: project, name: `cv1 bf ${project}`, createdBy: owner });
    process.argv = [...argv, '--verify', '--checksum'];
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      first = await runConversationV1Backfill({ mongo: source, pool: pool as unknown as Pool });
      second = await runConversationV1Backfill({ mongo: source, pool: pool as unknown as Pool });
    } finally {
      log.mockRestore();
      process.argv = argv;
    }
  }, 180_000);

  afterAll(async () => {
    await db.delete(schema.reports).where(inArray(schema.reports.id, [report1, report2]));
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, [groupId, governedId, orphanId]));
    await db.delete(schema.projects).where(eq(schema.projects.id, project));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspace));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [owner, member]));
    await close();
  });

  it('migrates what Postgres can hold, skips the rest with a reason, and checksums every pass', () => {
    expect(first.database).toBe(process.env.POSTGRES_TEST_DB);
    const expected: Record<PassKey, { accepted: number; written: number; skipped: Record<string, number> }> = {
      conversations: { accepted: 2, written: 2, skipped: { 'owner (createdBy) is not in identity.users': 1 } },
      messages: { accepted: 3, written: 3, skipped: { 'conversation skipped: owner (createdBy) is not in identity.users': 1, 'conversation is not in Postgres (not in Mongo conversations, or not migrated)': 1 } },
      links: { accepted: 3, written: 3, skipped: { 'message skipped: conversation skipped: owner (createdBy) is not in identity.users': 1 } },
      mentions: { accepted: 1, written: 1, skipped: {} },
      reports: { accepted: 2, written: 2, skipped: {} },
    };
    for (const key of Object.keys(expected) as PassKey[]) {
      const report = pass(first, key);
      expect({ key, accepted: report.accepted, written: report.written, inPostgresAfter: report.inPostgresAfter, skipped: report.skipped, insertFailures: report.insertFailures, verifyIssues: report.verifyIssues, checksumMatch: report.checksumMatch })
        .toEqual({ key, ...expected[key], inPostgresAfter: expected[key].accepted, insertFailures: {}, verifyIssues: 0, checksumMatch: true });
    }
    expect(pass(first, 'conversations').cleared).toEqual({
      'conversations.system_workspace_id (workspace not in Postgres)': { docs: 1, refs: 1 },
      'conversation_workspaces.workspace_id (workspace not in Postgres)': { docs: 1, refs: 1 },
    });
    expect(pass(first, 'links').cleared).toEqual({ 'messages.question_message_id (message not in Postgres)': { docs: 1, refs: 1 } });
    expect(pass(first, 'mentions').cleared).toEqual({ 'conversation_member_mentions.message_id (message not in Postgres)': { docs: 1, refs: 1 } });
    expect(pass(first, 'reports').danglingKept).toEqual({ 'reports.conversation_id': { docs: 1, refs: 1 }, 'reports.message_id': { docs: 1, refs: 1 } });
    expect(pass(first, 'conversations').anomalies).toMatchObject({ 'title: NUL removed': { docs: 1, refs: 1 } });
    expect(pass(first, 'messages').anomalies).toEqual({ 'content: NUL removed': { docs: 1, refs: 1 } });
    expect(pass(first, 'conversations').unmapped).toMatchObject({ messages: 3, __v: 1, 'branchProvenance._id': 1, 'groupMeta._id': 1 });
  });

  it('is idempotent: a second run writes nothing and finds everything in place', () => {
    for (const report of second.passes) {
      expect({ pass: report.pass, written: report.written, rowsAffected: report.rowsAffected, alreadyInPostgres: report.alreadyInPostgres, checksumMatch: report.checksumMatch })
        .toEqual({ pass: report.pass, written: 0, rowsAffected: 0, alreadyInPostgres: pass(first, report.pass).accepted, checksumMatch: true });
    }
  });

  it('reads the copied group conversation back through the live conversation store', async () => {
    const record = (await conversations.findById(groupId))!;
    expect(record).toMatchObject({
      id: groupId, title: 'Team room', createdBy: owner, runtimeMode: 'standard', runtimePurpose: 'chat', initializationStatus: 'ready',
      messageCount: 5, lastMessageAt: at('2026-03-01T10:00:00.000Z'), isArchived: false, isFirstMessage: false, isGroup: true, isShared: true,
      workspaces: [workspace], systemWorkspaceId: undefined, projectId: project, taggedAgentIds: [agent], groupTaggedAgentIds: [agent],
      branchRequestId: `br-${groupId}`, createdAt: stamp.createdAt, updatedAt: stamp.updatedAt,
      branchProvenance: { sourceConversationId: governedId, sourceTargetMessageId: m2, requestId: `br-${groupId}`, requestFingerprint: 'fp', branchedBy: owner, branchedAt: '2026-03-01T08:00:00.000Z', selectedAnswerIds: [m2] },
    });
    expect(record.selectedSkills).toHaveLength(1);
    expect(record.members).toEqual([
      { userId: owner, joinedAt: stamp.createdAt, status: 'owner', job: undefined, mentions: [{ messageId: m3, seenAt: at('2026-03-01T09:40:00.000Z') }] },
      { userId: member, joinedAt: at('2026-03-01T09:05:00.000Z'), status: 'member', job: 'Analyst', mentions: [{ messageId: m2, seenAt: undefined }] },
    ]);
    expect(record.invitedUsers).toEqual([{ email: `guest-${groupId}@example.com`, status: 'Guest', invitedAt: at('2026-03-01T09:10:00.000Z'), job: undefined }]);
    expect(await conversations.findActiveAccessById(groupId)).toMatchObject({ createdBy: owner, memberIds: [owner, member] });

    const governed = (await conversations.findByGovernedCreationRequest(owner, `gov-${governedId}`))!;
    expect(governed).toMatchObject({ id: governedId, runtimeMode: 'governed', isArchived: true, isGroup: false, members: [], governanceContext: { revisionNumber: 2, pinnedAt: '2026-03-01T08:30:00.000Z', runtimeDefinition: { primaryAgentId: agent, allowedAgentIds: [agent], workspaceIds: [workspace] } } });
    expect(await conversations.findById(orphanId, true)).toBeNull();
  });

  it('reads the copied messages back through the live message store, self references relinked', async () => {
    const thread = await messages.listByConversation(groupId);
    expect(thread.map((m) => m.id)).toEqual([m1, m2, m3]);
    const [user, ai, followUp] = thread;
    expect(user).toMatchObject({ conversationType: 'user', senderId: owner, content: 'question one', answerMessageId: m2, agentIds: [agent], requestId: `rq-${m1}`, isComplete: true, createdAt: at('2026-03-01T09:10:00.000Z') });
    expect(user.components).toBeNull(); // as for a user turn the live createUser writes
    expect(ai).toMatchObject({ conversationType: 'ai', questionMessageId: m1, modelId: 'model-x', inputTokens: 10, outputTokens: 20, durationMs: 300, feedback: 'dislike', reliabilityEvaluation: { status: 'completed' }, updatedAt: at('2026-03-01T09:11:30.000Z') });
    expect(ai.components).toEqual([{ id: 'c1', type: 'text', data: { content: 'answer', ref: m1, at: '2026-03-01T09:11:00.000Z' } }]);
    expect(followUp).toMatchObject({ parentMessageId: m1, questionMessageId: undefined, memberIds: [owner] });
    expect(await messages.findTurnByRequestId(groupId, owner, `rq-${m1}`)).toMatchObject({ user: { id: m1 } });
    expect(await messages.findById(orphanMessage)).toBeNull();
    expect(await messages.findById(strayMessage)).toBeNull();
  });

  it('reads the copied reports back through the live report store, weak references kept', async () => {
    expect(await reports.findById(report1)).toMatchObject({ conversationId: groupId, messageId: m2, userId: member, reason: 'wrong_information', status: 'pending', source: 'user', createdAt: stamp.createdAt });
    expect(await reports.findByUserAndMessage(owner, strayMessage)).toMatchObject({ id: report2, conversationId: strayConversationId, status: 'resolved', adminNotes: 'done' });
  });
});
