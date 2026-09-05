import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { PostgresConversationStore } from '../src/modules/conversation/persistence/postgres/postgres-conversation-store';
import { PostgresConversationBranchStore } from '../src/modules/conversation/persistence/postgres/postgres-conversation-branch-store';
import { PostgresMessageStore } from '../src/modules/conversation/persistence/postgres/postgres-message-store';
import { PostgresConversationAnalyticsStore } from '../src/modules/conversation/persistence/postgres/postgres-conversation-analytics-store';
import { PostgresConversationExpiryService } from '../src/modules/conversation/persistence/postgres/postgres-conversation-expiry.service';
import { PostgresConversationPlaybookHandoffStore } from '../src/modules/conversation/persistence/postgres/postgres-conversation-playbook-handoff-store';
import { PostgresReportStore } from '../src/modules/conversation/persistence/postgres/postgres-report-store';
import { PostgresShareStore } from '../src/modules/conversation/persistence/postgres/postgres-share-store';
import * as schema from '../src/modules/postgres/schema';

const ids = {
  owner: '111111111111111111111111',
  member: '222222222222222222222222',
  outsider: '333333333333333333333333',
  project: '444444444444444444444444',
  workspaceA: '555555555555555555555555',
  workspaceB: '666666666666666666666666',
  skill: '777777777777777777777777',
  agentA: '888888888888888888888888',
  agentB: '999999999999999999999999',
  agentC: '121212121212121212121212',
  group: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  plain: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  groupConversion: 'bcbcbcbcbcbcbcbcbcbcbcbc',
  platformActive: 'cccccccccccccccccccccccc',
  platformEmpty: 'dddddddddddddddddddddddd',
  message: 'eeeeeeeeeeeeeeeeeeeeeeee',
  staleReliability: 'e1e1e1e1e1e1e1e1e1e1e1e1',
  staleReliabilityHeartbeat: 'e2e2e2e2e2e2e2e2e2e2e2e2',
  oldConversation: 'abababababababababababab',
  oldMessage: 'cdcdcdcdcdcdcdcdcdcdcdcd',
  expiredShare: 'edededededededededededed',
  liveShare: 'fefefefefefefefefefefefe',
  expiredHandoff: 'acacacacacacacacacacacac',
  liveHandoff: 'bdbdbdbdbdbdbdbdbdbdbdbd',
} as const;

async function main(): Promise<void> {
  const database = process.env.POSTGRES_TEST_DB;
  if (!database || database === process.env.POSTGRES_DB) {
    throw new Error('A dedicated POSTGRES_TEST_DB is required');
  }

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 4,
  });

  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'drizzle' });
    await pool.query(
      'TRUNCATE TABLE conversation.reports, conversation.conversation_playbook_handoffs, conversation.shared_conversations, conversation.conversations CASCADE',
    );
    const store = new PostgresConversationStore(db);
    const invitedAt = new Date('2026-08-30T10:00:00.000Z');

    const created = await store.create({
      id: ids.group,
      title: '100% Ready',
      createdBy: ids.owner,
      workspaces: [ids.workspaceA, ids.workspaceB],
      selectedSkills: [ids.skill],
      taggedAgentIds: [ids.agentA],
      projectId: ids.project,
      isGroup: true,
      members: [
        {
          userId: ids.owner,
          joinedAt: invitedAt,
          status: 'owner',
          mentions: [],
        },
      ],
      invitedUsers: [
        {
          email: 'Member@Example.com',
          status: 'Guest',
          invitedAt,
          job: 'Reviewer',
        },
      ],
    });
    assert.deepEqual(created.workspaces, [ids.workspaceA, ids.workspaceB]);
    assert.deepEqual(created.selectedSkills, [ids.skill]);
    assert.deepEqual(created.taggedAgentIds, [ids.agentA]);

    const access = await store.findActiveAccessById(ids.group);
    assert.deepEqual(access, {
      id: ids.group,
      createdBy: ids.owner,
      memberIds: [ids.owner],
      invitedEmails: ['Member@Example.com'],
    });

    const joined = await store.joinGroup(
      ids.group,
      ids.member,
      'member@example.com',
      new Date('2026-08-30T11:00:00.000Z'),
    );
    assert.equal(joined?.members.at(-1)?.userId, ids.member);
    assert.equal(joined?.members.at(-1)?.job, 'Reviewer');
    assert.deepEqual(joined?.invitedUsers, []);
    assert.equal(
      await store.joinGroup(ids.group, ids.outsider, 'missing@example.com', new Date()),
      null,
    );

    await db.insert(schema.messages).values({
      id: ids.message,
      conversationId: ids.group,
      senderId: ids.owner,
      conversationType: 'user',
      content: 'under_score',
    });
    await store.addMention(ids.group, ids.outsider, ids.message);
    await store.addMention(ids.group, ids.member, ids.message);
    const seenAt = new Date('2026-08-30T12:00:00.000Z');
    await store.markMentionSeen(ids.group, ids.member, ids.message, seenAt);
    const withMention = await store.findById(ids.group);
    assert.equal(
      withMention?.members.find((member) => member.userId === ids.outsider),
      undefined,
    );
    assert.deepEqual(
      withMention?.members.find((member) => member.userId === ids.member)?.mentions,
      [{ messageId: ids.message, seenAt }],
    );

    await store.removeMember(ids.group, ids.member);
    await store.updateOwned(ids.group, ids.owner, {
      invitedUsers: [
        {
          email: 'Member@Example.com',
          status: 'Guest',
          invitedAt,
          job: 'Reviewer',
        },
      ],
    });
    const rejoined = await store.joinGroup(
      ids.group,
      ids.member,
      'member@example.com',
      new Date('2026-08-30T13:00:00.000Z'),
    );
    assert.deepEqual(
      rejoined?.members.find((member) => member.userId === ids.member)?.mentions,
      [],
    );

    const additions = await Promise.all([
      store.addGroupTaggedAgents(ids.group, [ids.agentA, ids.agentB]),
      store.addGroupTaggedAgents(ids.group, [ids.agentB, ids.agentC]),
    ]);
    assert.deepEqual(new Set(additions.flat()), new Set([ids.agentA, ids.agentB, ids.agentC]));
    const persistedGroupAgents = (await store.findById(ids.group))?.groupTaggedAgentIds ?? [];
    assert.equal(persistedGroupAgents.length, 3);
    assert.deepEqual(new Set(persistedGroupAgents), new Set([ids.agentA, ids.agentB, ids.agentC]));
    await store.replaceTaggedAgentIds(ids.group, []);
    assert.deepEqual((await store.findById(ids.group))?.taggedAgentIds, [ids.agentA]);

    await store.create({
      id: ids.plain,
      title: 'Plain title',
      createdBy: ids.owner,
      workspaces: [ids.workspaceB],
    });
    await store.create({
      id: ids.groupConversion,
      title: 'Convert to group',
      createdBy: ids.owner,
    });
    const converted = await store.updateOwned(ids.groupConversion, ids.owner, {
      isGroup: true,
      members: [
        {
          userId: ids.owner,
          joinedAt: invitedAt,
          status: 'owner',
          mentions: [],
        },
      ],
      invitedUsers: [
        {
          email: 'convert@example.com',
          status: 'Guest',
          invitedAt,
          job: 'Reviewer',
        },
      ],
    });
    assert.equal(converted?.isGroup, true);
    assert.deepEqual(converted?.members.map((member) => member.userId), [ids.owner]);
    assert.equal(converted?.members[0]?.status, 'owner');
    assert.equal(converted?.invitedUsers[0]?.email, 'convert@example.com');
    const messageStore = new PostgresMessageStore(db);
    const staleRequestedAt = '2026-08-30T08:00:00.000Z';
    await db.insert(schema.messages).values([
      {
        id: ids.staleReliability,
        conversationId: ids.plain,
        conversationType: 'ai',
        reliabilityEvaluation: { status: 'pending', requestedAt: staleRequestedAt },
        updatedAt: new Date(staleRequestedAt),
      },
      {
        id: ids.staleReliabilityHeartbeat,
        conversationId: ids.plain,
        conversationType: 'ai',
        reliabilityEvaluation: { status: 'pending', requestedAt: staleRequestedAt },
        reliabilityEvaluationHeartbeatAt: new Date('2026-08-30T08:30:00.000Z'),
        updatedAt: new Date(staleRequestedAt),
      },
    ]);
    const failedReliability = await messageStore.failStaleReliability(
      new Date('2026-08-30T09:00:00.000Z'),
    );
    assert.deepEqual(
      new Set(failedReliability.map((message) => message.id)),
      new Set([ids.staleReliability, ids.staleReliabilityHeartbeat]),
    );
    for (const message of failedReliability) {
      assert.equal(message.conversationId, ids.plain);
      assert.equal(message.reliabilityEvaluation?.status, 'failed');
      assert.equal(
        message.reliabilityEvaluation?.failureCode,
        'stale_pending_after_restart',
      );
      assert.equal(typeof message.reliabilityEvaluation?.evaluatedAt, 'string');
      assert.equal(message.reliabilityEvaluationHeartbeatAt, undefined);
    }
    const userMessage = await messageStore.createUser({
      conversationId: ids.plain,
      senderId: ids.owner,
      content: 'Branch source question',
      requestId: 'turn-1',
    });
    const aiMessage = await messageStore.createAiPlaceholder({
      conversationId: ids.plain,
      questionMessageId: userMessage.id,
      senderId: ids.owner,
      requestId: 'turn-1',
    });
    const leaseResults = await Promise.all([
      messageStore.claimStream(aiMessage.id, 'lease-a', new Date(), new Date(Date.now() + 60_000)),
      messageStore.claimStream(aiMessage.id, 'lease-b', new Date(), new Date(Date.now() + 60_000)),
    ]);
    assert.equal(leaseResults.filter(Boolean).length, 1);
    const winningLease = leaseResults[0] ? 'lease-a' : 'lease-b';
    assert.equal(
      await messageStore.completeAi({
        messageId: aiMessage.id,
        streamExecutionLeaseId: winningLease,
        components: [{ id: 'answer', type: 'text', data: { content: 'Branch source answer' } }],
      }).then(Boolean),
      true,
    );
    assert.equal(
      await messageStore.completeAi({
        messageId: aiMessage.id,
        streamExecutionLeaseId: winningLease,
        components: [],
      }),
      null,
    );
    const turn = await messageStore.findTurnByRequestId(ids.plain, ids.owner, 'turn-1');
    assert.equal(turn?.user.id, userMessage.id);
    assert.equal(turn?.aiId, aiMessage.id);

    const source = await store.findById(ids.plain);
    assert.ok(source);
    const sourcePath = await messageStore.listByConversation(ids.plain);
    const branchStore = new PostgresConversationBranchStore(db);
    const branch = await branchStore.createPending({
      source,
      path: sourcePath,
      selectedAnswerIds: [aiMessage.id],
      requestId: 'branch-request-1',
      requestFingerprint: 'branch-fingerprint-1',
      targetMessageId: aiMessage.id,
      userId: ids.owner,
    });
    assert.equal(
      (await branchStore.findByRequest(ids.owner, 'branch-request-1'))?.id,
      branch.id,
    );
    const branchClaims = await Promise.all([
      branchStore.claimSeed(branch.id, 'branch-attempt-a'),
      branchStore.claimSeed(branch.id, 'branch-attempt-b'),
    ]);
    assert.equal(branchClaims.filter(Boolean).length, 1);
    const winningAttempt = branchClaims[0] ? 'branch-attempt-a' : 'branch-attempt-b';
    assert.equal(await branchStore.finalizeSeed(branch.id, 'wrong-attempt'), false);
    assert.equal(await branchStore.finalizeSeed(branch.id, winningAttempt), true);
    assert.equal((await messageStore.listByConversation(branch.id)).length, sourcePath.length);

    const reportStore = new PostgresReportStore(db);
    const report = await reportStore.create({
      conversationId: ids.plain,
      messageId: aiMessage.id,
      userId: ids.owner,
      reason: 'inaccurate',
      description: 'Incorrect answer',
      source: 'user',
    });
    assert.equal((await reportStore.findById(report.id))?.messageId, aiMessage.id);

    const shareStore = new PostgresShareStore(db);
    const publicShare = await shareStore.createPublic({
      originalConversationId: ids.plain,
      sharedBy: ids.owner,
      title: 'Shared source',
      messages: [],
      accessToken: 'live-share-token',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    assert.equal((await shareStore.findPublicByToken('live-share-token'))?.id, publicShare.id);
    assert.equal(await shareStore.incrementViewCount(publicShare.id), 1);

    const handoffStore = new PostgresConversationPlaybookHandoffStore(db);
    const handoff = await handoffStore.createPrepared({
      id: ids.liveHandoff,
      contractVersion: 1,
      handoffId: randomUUID(),
      ownerId: ids.owner,
      sourceConversationId: ids.plain,
      targetMessageId: aiMessage.id,
      displayedAnswerVersion: 'original',
      creationRequestId: 'handoff-request-live',
      creationRequestFingerprint: 'request-fingerprint',
      clientBranchSelectionFingerprint: 'client-fingerprint',
      canonicalPathFingerprint: 'path-fingerprint',
      contextFingerprint: 'context-fingerprint',
      canonicalSelectedAnswerIds: [aiMessage.id],
      platformConversationId: ids.platformActive,
      context: {
        contextVersion: 1,
        executionSummaries: [],
        planSteps: [],
        actions: [],
        agents: [],
        skills: [],
        references: [],
        projection: {
          generatedAt: new Date().toISOString(),
          sourceMessageCount: 2,
          includedMessageCount: 2,
          omissions: {},
        },
      },
      candidateBindings: {
        workspaceIds: [],
        documentIds: [],
        connectorIds: [],
        agentIds: [],
        skillIds: [],
      },
      defaultWorkspaceIds: [],
      preparedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    assert.equal(handoff.created, true);
    assert.equal(
      (await handoffStore.findByCreationRequest(ids.owner, 'handoff-request-live'))?.id,
      ids.liveHandoff,
    );

    await db.insert(schema.conversations).values({
      id: ids.oldConversation,
      title: 'Old conversation',
      createdBy: ids.owner,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await db.insert(schema.messages).values({
      id: ids.oldMessage,
      conversationId: ids.oldConversation,
      conversationType: 'ai',
      components: [{ id: 'old-answer', type: 'text', data: { content: 'Old answer' } }],
      feedback: 'like',
      isComplete: true,
      createdAt: new Date('2026-08-30T12:00:00.000Z'),
      updatedAt: new Date('2026-08-30T12:00:00.000Z'),
    });
    const analyticsStore = new PostgresConversationAnalyticsStore(db);
    const quality = await analyticsStore.getQualityAnalytics(
      [ids.owner],
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-31T23:59:59.999Z'),
    );
    assert.equal(quality.feedbackDistribution.likes, 0);

    await db.insert(schema.sharedConversations).values({
      id: ids.expiredShare,
      originalConversationId: ids.plain,
      sharedBy: ids.owner,
      shareType: 'public',
      title: 'Expired share',
      accessToken: 'expired-share-token',
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const expiredHandoffId = randomUUID();
    await db.insert(schema.conversationPlaybookHandoffs).values({
      id: ids.expiredHandoff,
      handoffId: expiredHandoffId,
      contractVersion: 1,
      ownerId: ids.owner,
      sourceConversationId: ids.plain,
      targetMessageId: aiMessage.id,
      displayedAnswerVersion: 'original',
      creationRequestId: 'handoff-request-expired',
      creationRequestFingerprint: 'request-fingerprint',
      clientBranchSelectionFingerprint: 'client-fingerprint',
      canonicalPathFingerprint: 'path-fingerprint',
      contextFingerprint: 'context-fingerprint',
      canonicalSelectedAnswerIds: [aiMessage.id],
      platformConversationId: ids.platformActive,
      context: {},
      candidateBindings: {},
      defaultWorkspaceIds: [],
      preparedAt: new Date('2020-01-01T00:00:00.000Z'),
      expiresAt: new Date('2020-01-02T00:00:00.000Z'),
    });
    const expiryLogger = {
      setContext: () => undefined,
      error: (message: string) => {
        throw new Error(message);
      },
    };
    await new PostgresConversationExpiryService(db, expiryLogger as never).cleanupExpired();
    assert.equal(await shareStore.findById(ids.expiredShare), null);
    assert.equal(await handoffStore.findOwned(expiredHandoffId, ids.owner), null);
    assert.equal(await shareStore.findById(publicShare.id).then(Boolean), true);

    const literalPercent = await store.list({
      userId: ids.owner,
      page: 1,
      limit: 20,
      search: '%',
      sortBy: 'title',
      sortOrder: 'asc',
    });
    assert.deepEqual(
      literalPercent.records.map((record) => record.id),
      [ids.group],
    );
    const literalUnderscore = await store.list({
      userId: ids.owner,
      page: 1,
      limit: 20,
      search: '_',
      searchScope: 'fulltext',
      sortBy: 'title',
      sortOrder: 'asc',
    });
    assert.deepEqual(
      literalUnderscore.records.map((record) => record.id),
      [ids.group],
    );

    await store.create({
      id: ids.platformActive,
      title: 'Active platform conversation',
      createdBy: ids.owner,
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: ids.agentA,
    });
    await store.create({
      id: ids.platformEmpty,
      title: 'Empty platform conversation',
      createdBy: ids.owner,
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: ids.agentA,
    });
    await store.touchMessage(ids.platformActive);
    assert.equal(
      (await store.findLatestPlatformConversation(ids.owner, ids.agentA))?.id,
      ids.platformActive,
    );
    const platformDescending = await store.list({
      userId: ids.owner,
      page: 1,
      limit: 20,
      sortBy: 'lastMessageAt',
      sortOrder: 'desc',
      runtimePurpose: 'platform_copilot',
    });
    assert.deepEqual(
      platformDescending.records.map((record) => record.id),
      [ids.platformActive, ids.platformEmpty],
    );
    const platformAscending = await store.list({
      userId: ids.owner,
      page: 1,
      limit: 20,
      sortBy: 'lastMessageAt',
      sortOrder: 'asc',
      runtimePurpose: 'platform_copilot',
    });
    assert.deepEqual(
      platformAscending.records.map((record) => record.id),
      [ids.platformEmpty, ids.platformActive],
    );

    assert.equal(await store.countByProject(ids.owner, ids.project), 1);
    assert.deepEqual(
      await store.countByProjects(ids.owner, [ids.project]),
      new Map([[ids.project, 1]]),
    );
    assert.equal(await store.detachProject(ids.outsider, ids.project), 0);
    assert.equal(await store.detachProject(ids.owner, ids.project), 1);
    assert.equal(await store.removeWorkspaceFromAll(ids.workspaceB), 3);
    assert.deepEqual((await store.findById(ids.group))?.workspaces, [ids.workspaceA]);

    assert.equal(await store.deleteOwned(ids.group, ids.outsider), null);
    assert.equal((await store.deleteOwned(ids.group, ids.owner))?.id, ids.group);
    assert.equal(await store.findById(ids.group, true), null);
    const messageCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM conversation.messages WHERE id = $1',
      [ids.message],
    );
    assert.equal(messageCount.rows[0]?.count, 0);

    process.stdout.write('PostgreSQL Conversation persistence contract passed\n');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : 'Conversation store test failed'}\n`,
  );
  process.exitCode = 1;
});
