import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  ConversationAccessRecord,
  ConversationCursorListInput,
  ConversationListInput,
  ConversationRecord,
  ConversationSummaryRecord,
  ConversationStore,
  CreateConversationRecord,
} from '../conversation-store';
import {
  conversationFilterHash,
  decodeConversationCursor,
  encodeConversationCursor,
} from '../../utils/conversation-cursor';
import { BadRequestException } from '../../../exceptions';
import { ErrorCode } from '../../../exceptions/constants/error-codes';

@Injectable()
export class PostgresConversationStore implements ConversationStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async findActiveAccessById(id: string): Promise<ConversationAccessRecord | null> {
    const [conversation] = await this.db
      .select({
        id: schema.conversations.id,
        createdBy: schema.conversations.createdBy,
        projectId: schema.conversations.projectId,
        memberIds: sql<string[]>`COALESCE((SELECT array_agg(gm.user_id ORDER BY gm.position) FROM conversation.conversation_group_members gm WHERE gm.conversation_id = ${schema.conversations.id}), ARRAY[]::bpchar[])`,
        invitedEmails: sql<string[]>`COALESCE((SELECT array_agg(gi.email ORDER BY gi.position) FROM conversation.conversation_group_invites gi WHERE gi.conversation_id = ${schema.conversations.id}), ARRAY[]::varchar[])`,
      })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.initializationStatus, 'ready'),
        ),
      )
      .limit(1);
    if (!conversation) return null;
    return {
      id: conversation.id.trim(),
      createdBy: conversation.createdBy.trim(),
      projectId: conversation.projectId?.trim() ?? null,
      memberIds: conversation.memberIds.map((value) => value.trim()),
      invitedEmails: conversation.invitedEmails,
    };
  }

  async countByProject(projectId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.conversations)
      .where(eq(schema.conversations.projectId, projectId));
    return row?.count ?? 0;
  }

  async countByProjects(projectIds: string[]): Promise<Map<string, number>> {
    if (!projectIds.length) return new Map();
    const rows = await this.db
      .select({ projectId: schema.conversations.projectId, count: sql<number>`count(*)::int` })
      .from(schema.conversations)
      .where(inArray(schema.conversations.projectId, projectIds))
      .groupBy(schema.conversations.projectId);
    return new Map(
      rows.filter((row) => row.projectId).map((row) => [row.projectId!.trim(), row.count]),
    );
  }

  async detachProject(projectId: string): Promise<number> {
    const rows = await this.db
      .update(schema.conversations)
      .set({ projectId: null, updatedAt: new Date() })
      .where(eq(schema.conversations.projectId, projectId))
      .returning({ id: schema.conversations.id });
    return rows.length;
  }

  async removeWorkspaceFromAll(workspaceId: string): Promise<number> {
    const rows = await this.db
      .delete(schema.conversationWorkspaces)
      .where(eq(schema.conversationWorkspaces.value, workspaceId))
      .returning({ conversationId: schema.conversationWorkspaces.conversationId });
    return new Set(rows.map((row) => row.conversationId.trim())).size;
  }

  private hydratedSelection() {
    return {
      ...getTableColumns(schema.conversations),
      workspaceIds: sql<string[]>`COALESCE((SELECT array_agg(cw.workspace_id ORDER BY cw.position) FROM conversation.conversation_workspaces cw WHERE cw.conversation_id = ${schema.conversations.id}), ARRAY[]::bpchar[])`,
      skillIds: sql<string[]>`COALESCE((SELECT array_agg(cs.skill_id ORDER BY cs.position) FROM conversation.conversation_selected_skills cs WHERE cs.conversation_id = ${schema.conversations.id}), ARRAY[]::bpchar[])`,
      taggedIds: sql<string[]>`COALESCE((SELECT array_agg(ca.agent_id ORDER BY ca.position) FROM conversation.conversation_tagged_agents ca WHERE ca.conversation_id = ${schema.conversations.id}), ARRAY[]::bpchar[])`,
      groupTaggedIds: sql<string[]>`COALESCE((SELECT array_agg(cga.agent_id ORDER BY cga.position) FROM conversation.conversation_group_tagged_agents cga WHERE cga.conversation_id = ${schema.conversations.id}), ARRAY[]::bpchar[])`,
      memberRows: sql<Array<{
        userId: string;
        joinedAt: string;
        status: 'owner' | 'member';
        job: string | null;
        mentions: Array<{ messageId: string; seenAt: string | null }>;
      }>>`COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'userId', gm.user_id,
          'joinedAt', gm.joined_at,
          'status', gm.status,
          'job', gm.job,
          'mentions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('messageId', mm.message_id, 'seenAt', mm.seen_at) ORDER BY mm.position)
            FROM conversation.conversation_member_mentions mm
            WHERE mm.conversation_id = gm.conversation_id AND mm.user_id = gm.user_id
          ), '[]'::jsonb)
        ) ORDER BY gm.position)
        FROM conversation.conversation_group_members gm
        WHERE gm.conversation_id = ${schema.conversations.id}
      ), '[]'::jsonb)`,
      inviteRows: sql<Array<{
        email: string;
        status: 'Confirmed' | 'Guest';
        invitedAt: string;
        job: string | null;
      }>>`COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'email', gi.email,
          'status', gi.status,
          'invitedAt', gi.invited_at,
          'job', gi.job
        ) ORDER BY gi.position)
        FROM conversation.conversation_group_invites gi
        WHERE gi.conversation_id = ${schema.conversations.id}
      ), '[]'::jsonb)`,
    };
  }

  private mapAggregateRow(
    row: typeof schema.conversations.$inferSelect & {
      workspaceIds: string[];
      skillIds: string[];
      taggedIds: string[];
      groupTaggedIds: string[];
      memberRows: Array<{
        userId: string;
        joinedAt: string;
        status: 'owner' | 'member';
        job: string | null;
        mentions: Array<{ messageId: string; seenAt: string | null }>;
      }>;
      inviteRows: Array<{
        email: string;
        status: 'Confirmed' | 'Guest';
        invitedAt: string;
        job: string | null;
      }>;
    },
  ): ConversationRecord {
    return {
      ...this.mapHydratedRow(row, {
        workspaces: [],
        skills: [],
        tagged: [],
        groupTagged: [],
        members: [],
        invites: [],
        mentions: [],
      }),
      workspaces: row.workspaceIds.map((value) => value.trim()),
      selectedSkills: row.skillIds.map((value) => value.trim()),
      taggedAgentIds: row.taggedIds.map((value) => value.trim()),
      groupTaggedAgentIds: row.groupTaggedIds.map((value) => value.trim()),
      members: row.memberRows.map((member) => ({
        userId: member.userId.trim(),
        joinedAt: new Date(member.joinedAt),
        status: member.status,
        job: member.job ?? undefined,
        mentions: member.mentions.map((mention) => ({
          messageId: mention.messageId.trim(),
          seenAt: mention.seenAt ? new Date(mention.seenAt) : undefined,
        })),
      })),
      invitedUsers: row.inviteRows.map((invite) => ({
        email: invite.email,
        status: invite.status,
        invitedAt: new Date(invite.invitedAt),
        job: invite.job ?? undefined,
      })),
    };
  }

  private async findOne(where: ReturnType<typeof and>): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .select(this.hydratedSelection())
      .from(schema.conversations)
      .where(where)
      .limit(1);
    return row ? this.mapAggregateRow(row) : null;
  }

  private async hydrate(
    row: typeof schema.conversations.$inferSelect,
  ): Promise<ConversationRecord> {
    return (await this.hydrateMany([row]))[0];
  }

  private async hydrateMany(
    rows: Array<typeof schema.conversations.$inferSelect>,
  ): Promise<ConversationRecord[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id.trim());
    const [workspaces, skills, tagged, groupTagged, members, invites, mentions] = await Promise.all(
      [
        this.db
          .select()
          .from(schema.conversationWorkspaces)
          .where(inArray(schema.conversationWorkspaces.conversationId, ids))
          .orderBy(
            schema.conversationWorkspaces.conversationId,
            schema.conversationWorkspaces.position,
          ),
        this.db
          .select()
          .from(schema.conversationSelectedSkills)
          .where(inArray(schema.conversationSelectedSkills.conversationId, ids))
          .orderBy(
            schema.conversationSelectedSkills.conversationId,
            schema.conversationSelectedSkills.position,
          ),
        this.db
          .select()
          .from(schema.conversationTaggedAgents)
          .where(inArray(schema.conversationTaggedAgents.conversationId, ids))
          .orderBy(
            schema.conversationTaggedAgents.conversationId,
            schema.conversationTaggedAgents.position,
          ),
        this.db
          .select()
          .from(schema.conversationGroupTaggedAgents)
          .where(inArray(schema.conversationGroupTaggedAgents.conversationId, ids))
          .orderBy(
            schema.conversationGroupTaggedAgents.conversationId,
            schema.conversationGroupTaggedAgents.position,
          ),
        this.db
          .select()
          .from(schema.conversationGroupMembers)
          .where(inArray(schema.conversationGroupMembers.conversationId, ids))
          .orderBy(
            schema.conversationGroupMembers.conversationId,
            schema.conversationGroupMembers.position,
          ),
        this.db
          .select()
          .from(schema.conversationGroupInvites)
          .where(inArray(schema.conversationGroupInvites.conversationId, ids))
          .orderBy(
            schema.conversationGroupInvites.conversationId,
            schema.conversationGroupInvites.position,
          ),
        this.db
          .select()
          .from(schema.conversationMemberMentions)
          .where(inArray(schema.conversationMemberMentions.conversationId, ids))
          .orderBy(
            schema.conversationMemberMentions.conversationId,
            schema.conversationMemberMentions.position,
          ),
      ],
    );
    const byConversation = <T extends { conversationId: string }>(items: T[]) => {
      const grouped = new Map<string, T[]>();
      for (const item of items) {
        const id = item.conversationId.trim();
        const existing = grouped.get(id);
        if (existing) existing.push(item);
        else grouped.set(id, [item]);
      }
      return grouped;
    };
    const workspaceMap = byConversation(workspaces);
    const skillMap = byConversation(skills);
    const taggedMap = byConversation(tagged);
    const groupTaggedMap = byConversation(groupTagged);
    const memberMap = byConversation(members);
    const inviteMap = byConversation(invites);
    const mentionMap = byConversation(mentions);
    return rows.map((row) => this.mapHydratedRow(row, {
      workspaces: workspaceMap.get(row.id.trim()) ?? [],
      skills: skillMap.get(row.id.trim()) ?? [],
      tagged: taggedMap.get(row.id.trim()) ?? [],
      groupTagged: groupTaggedMap.get(row.id.trim()) ?? [],
      members: memberMap.get(row.id.trim()) ?? [],
      invites: inviteMap.get(row.id.trim()) ?? [],
      mentions: mentionMap.get(row.id.trim()) ?? [],
    }));
  }

  private mapHydratedRow(
    row: typeof schema.conversations.$inferSelect,
    related: {
      workspaces: Array<typeof schema.conversationWorkspaces.$inferSelect>;
      skills: Array<typeof schema.conversationSelectedSkills.$inferSelect>;
      tagged: Array<typeof schema.conversationTaggedAgents.$inferSelect>;
      groupTagged: Array<typeof schema.conversationGroupTaggedAgents.$inferSelect>;
      members: Array<typeof schema.conversationGroupMembers.$inferSelect>;
      invites: Array<typeof schema.conversationGroupInvites.$inferSelect>;
      mentions: Array<typeof schema.conversationMemberMentions.$inferSelect>;
    },
  ): ConversationRecord {
    const id = row.id.trim();
    return {
      id,
      runtimeMode: row.runtimeMode as ConversationRecord['runtimeMode'],
      runtimePurpose: row.runtimePurpose as ConversationRecord['runtimePurpose'],
      pinnedAgentId: row.pinnedAgentId?.trim() ?? null,
      platformCopilotCreationRequestId: row.platformCopilotCreationRequestId ?? undefined,
      governedCreationRequestId: row.governedCreationRequestId ?? undefined,
      title: row.title,
      createdBy: row.createdBy.trim(),
      workspaces: related.workspaces.map((item) => item.value.trim()),
      selectedSkills: related.skills.map((item) => item.value.trim()),
      taggedAgentIds: related.tagged.map((item) => item.value.trim()),
      systemWorkspaceId: row.systemWorkspaceId?.trim(),
      projectId: row.projectId?.trim() ?? null,
      lastMessageAt: row.lastMessageAt ?? undefined,
      messageCount: row.messageCount,
      isArchived: row.isArchived,
      isShared: row.isShared,
      sharedFrom: row.sharedFrom?.trim(),
      initializationStatus: row.initializationStatus as ConversationRecord['initializationStatus'],
      branchSeedAttemptId: row.branchSeedAttemptId ?? undefined,
      branchRequestId: row.branchRequestId ?? undefined,
      branchProvenance: row.branchProvenance as ConversationRecord['branchProvenance'],
      governanceContext: row.governanceContext as ConversationRecord['governanceContext'],
      isGroup: row.isGroup,
      members: related.members.map((member) => ({
        userId: member.userId.trim(),
        joinedAt: member.joinedAt,
        status: member.status as 'owner' | 'member',
        job: member.job ?? undefined,
        mentions: related.mentions
          .filter((mention) => mention.userId.trim() === member.userId.trim())
          .map((mention) => ({
            messageId: mention.messageId.trim(),
            seenAt: mention.seenAt ?? undefined,
          })),
      })),
      invitedUsers: related.invites.map((invite) => ({
        email: invite.email,
        status: invite.status as 'Confirmed' | 'Guest',
        invitedAt: invite.invitedAt,
        job: invite.job ?? undefined,
      })),
      groupTaggedAgentIds: related.groupTagged.map((item) => item.value.trim()),
      isFirstMessage: row.isFirstMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async replaceOrdered(
    tx: NodePgDatabase<typeof schema>,
    table: typeof schema.conversationWorkspaces,
    conversationId: string,
    values: string[],
  ): Promise<void> {
    await tx.delete(table).where(eq(table.conversationId, conversationId));
    if (values.length)
      await tx
        .insert(table)
        .values(values.map((value, position) => ({ conversationId, position, value })));
  }
  async create(input: CreateConversationRecord): Promise<ConversationRecord> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.conversations).values({
        id: input.id,
        title: input.title,
        createdBy: input.createdBy,
        runtimeMode: input.runtimeMode ?? 'standard',
        runtimePurpose: input.runtimePurpose ?? 'chat',
        pinnedAgentId: input.pinnedAgentId,
        platformCopilotCreationRequestId: input.platformCopilotCreationRequestId,
        governedCreationRequestId: input.governedCreationRequestId,
        governanceContext: input.governanceContext,
        projectId: input.projectId,
        isGroup: input.isGroup ?? false,
        createdAt: now,
        updatedAt: now,
      });
      await this.replaceOrdered(
        tx,
        schema.conversationWorkspaces,
        input.id,
        input.workspaces ?? [],
      );
      await this.replaceOrdered(
        tx,
        schema.conversationSelectedSkills,
        input.id,
        input.selectedSkills ?? [],
      );
      await this.replaceOrdered(
        tx,
        schema.conversationTaggedAgents,
        input.id,
        input.taggedAgentIds ?? [],
      );
      if (input.members?.length)
        await tx.insert(schema.conversationGroupMembers).values(
          input.members.map((member, position) => ({
            conversationId: input.id,
            userId: member.userId,
            position,
            joinedAt: member.joinedAt,
            status: member.status,
            job: member.job,
          })),
        );
      if (input.invitedUsers?.length)
        await tx.insert(schema.conversationGroupInvites).values(
          input.invitedUsers.map((invite, position) => ({
            conversationId: input.id,
            position,
            email: invite.email,
            normalizedEmail: invite.email.trim().toLowerCase(),
            status: invite.status,
            invitedAt: invite.invitedAt,
            job: invite.job,
          })),
        );
    });
    return (await this.findById(input.id, true))!;
  }

  async findById(id: string, includeInitializing = false): Promise<ConversationRecord | null> {
    const conditions = [eq(schema.conversations.id, id)];
    if (!includeInitializing)
      conditions.push(
        notInArray(schema.conversations.initializationStatus, [
          'pending',
          'seeding',
          'cleanup_pending',
        ]),
      );
    return this.findOne(and(...conditions));
  }

  async findByPlatformCreationRequest(
    ownerId: string,
    requestId: string,
  ): Promise<ConversationRecord | null> {
    return this.findOne(
      and(
        eq(schema.conversations.createdBy, ownerId),
        eq(schema.conversations.runtimePurpose, 'platform_copilot'),
        eq(schema.conversations.platformCopilotCreationRequestId, requestId),
      ),
    );
  }

  async findLatestPlatformConversation(
    ownerId: string,
    pinnedAgentId: string,
  ): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.createdBy, ownerId),
          eq(schema.conversations.runtimePurpose, 'platform_copilot'),
          eq(schema.conversations.pinnedAgentId, pinnedAgentId),
        ),
      )
      .orderBy(
        sql`${desc(schema.conversations.lastMessageAt)} NULLS LAST`,
        desc(schema.conversations.createdAt),
        desc(schema.conversations.id),
      )
      .limit(1);
    return row ? this.hydrate(row) : null;
  }

  async findByGovernedCreationRequest(
    ownerId: string,
    requestId: string,
  ): Promise<ConversationRecord | null> {
    return this.findOne(
      and(
        eq(schema.conversations.createdBy, ownerId),
        eq(schema.conversations.governedCreationRequestId, requestId),
      ),
    );
  }

  async list(
    input: ConversationListInput,
  ): Promise<{ records: ConversationRecord[]; total: number }> {
    // Unscoped project listing: the service already verified the requester's
    // project access, so the per-user ownership predicate is dropped and all
    // collaborators' conversations in the project are returned.
    const unscopedProject = Boolean(input.projectIdUnscoped && input.projectId && input.projectId !== 'none');
    const access = unscopedProject
      ? undefined
      : input.runtimePurpose === 'platform_copilot'
        ? and(
            eq(schema.conversations.createdBy, input.userId),
            eq(schema.conversations.runtimePurpose, 'platform_copilot'),
          )
        : and(
            ne(schema.conversations.runtimePurpose, 'platform_copilot'),
            or(
              eq(schema.conversations.createdBy, input.userId),
              sql`EXISTS (SELECT 1 FROM conversation.conversation_group_members gm WHERE gm.conversation_id = ${schema.conversations.id} AND gm.user_id = ${input.userId})`,
            ),
          );
    const conditions = [
      ...(access ? [access] : []),
       eq(schema.conversations.initializationStatus, 'ready'),
    ];
    if (input.isArchived !== undefined)
      conditions.push(eq(schema.conversations.isArchived, input.isArchived));
    if (input.projectId === 'none') conditions.push(isNull(schema.conversations.projectId));
    else if (input.projectId) conditions.push(eq(schema.conversations.projectId, input.projectId));
    if (input.search) {
      const escaped = input.search.replace(/[\\%_]/g, '\\$&');
      const pattern = `%${escaped}%`;
      conditions.push(
        input.searchScope === 'fulltext'
          ? or(
              ilike(schema.conversations.title, pattern),
              sql`EXISTS (SELECT 1 FROM conversation.messages m WHERE m.conversation_id = ${schema.conversations.id} AND m.content ILIKE ${pattern} ESCAPE '\\')`,
            )!
          : ilike(schema.conversations.title, pattern),
      );
    }
    const where = and(...conditions);
    const sortColumn =
      input.sortBy === 'createdAt'
        ? schema.conversations.createdAt
        : input.sortBy === 'title'
          ? schema.conversations.title
          : schema.conversations.lastMessageAt;
    const sortExpression =
      input.sortBy === 'lastMessageAt'
        ? input.sortOrder === 'asc'
          ? sql`${asc(sortColumn)} NULLS FIRST`
          : sql`${desc(sortColumn)} NULLS LAST`
        : input.sortOrder === 'asc'
          ? asc(sortColumn)
          : desc(sortColumn);
    const [rows, count] = await Promise.all([
      this.db
        .select(this.hydratedSelection())
        .from(schema.conversations)
        .where(where)
        .orderBy(sortExpression, input.sortOrder === 'asc' ? asc(schema.conversations.id) : desc(schema.conversations.id))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.conversations)
        .where(where),
    ]);
    return {
      records: rows.map((row) => this.mapAggregateRow(row)),
      total: count[0]?.count ?? 0,
    };
  }

  async listCursor(input: ConversationCursorListInput): Promise<{
    records: ConversationSummaryRecord[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const filters = {
      search: input.search?.trim() || null,
      searchScope: input.searchScope ?? null,
      isArchived: input.isArchived ?? null,
      projectId: input.projectId ?? null,
      projectIdUnscoped: input.projectIdUnscoped ?? null,
      runtimePurpose: input.runtimePurpose ?? null,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    };
    const filterHash = conversationFilterHash(filters);
    const cursor = input.cursor ? decodeConversationCursor(input.cursor) : undefined;
    if (cursor && (cursor.f !== filterHash || cursor.s !== input.sortBy || cursor.d !== input.sortOrder)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Conversation cursor does not match the request filters');
    }
    const unscopedProject = Boolean(input.projectIdUnscoped && input.projectId && input.projectId !== 'none');
    const conditions = [
      eq(schema.conversations.initializationStatus, 'ready'),
      unscopedProject
        ? undefined
        : input.runtimePurpose === 'platform_copilot'
          ? and(eq(schema.conversations.createdBy, input.userId), eq(schema.conversations.runtimePurpose, 'platform_copilot'))!
          : and(
              ne(schema.conversations.runtimePurpose, 'platform_copilot'),
              sql`${schema.conversations.id} IN (
                SELECT c.id FROM conversation.conversations c WHERE c.created_by = ${input.userId}
                UNION
                SELECT gm.conversation_id FROM conversation.conversation_group_members gm WHERE gm.user_id = ${input.userId}
              )`,
            )!,
    ].filter((condition) => condition !== undefined);
    if (input.isArchived !== undefined) conditions.push(eq(schema.conversations.isArchived, input.isArchived));
    if (input.projectId === 'none') conditions.push(isNull(schema.conversations.projectId));
    else if (input.projectId) conditions.push(eq(schema.conversations.projectId, input.projectId));
    if (input.search) {
      const search = input.search.trim();
      if (search.length < 3) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Search must contain at least three characters');
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        input.searchScope === 'fulltext'
          ? or(
              ilike(schema.conversations.title, pattern),
              sql`${schema.conversations.id} IN (SELECT DISTINCT m.conversation_id FROM conversation.messages m WHERE m.content ILIKE ${pattern} ESCAPE '\\')`,
            )!
          : ilike(schema.conversations.title, pattern),
      );
    }
    const sortColumn = input.sortBy === 'createdAt'
      ? schema.conversations.createdAt
      : input.sortBy === 'title'
        ? schema.conversations.title
        : schema.conversations.lastMessageAt;
    if (cursor) {
      const after = input.sortOrder === 'asc' ? sql`>` : sql`<`;
      if (input.sortBy === 'lastMessageAt') {
        if (cursor.n === 1) {
          conditions.push(
            input.sortOrder === 'asc'
              ? or(
                  and(
                    isNull(schema.conversations.lastMessageAt),
                    sql`${schema.conversations.id} > ${cursor.id}`,
                  ),
                  sql`${schema.conversations.lastMessageAt} IS NOT NULL`,
                )!
              : and(
                  isNull(schema.conversations.lastMessageAt),
                  sql`${schema.conversations.id} < ${cursor.id}`,
                )!,
          );
        } else if (input.sortOrder === 'desc') {
          conditions.push(sql`(${schema.conversations.lastMessageAt} < ${new Date(cursor.value!)} OR (${schema.conversations.lastMessageAt} = ${new Date(cursor.value!)} AND ${schema.conversations.id} < ${cursor.id}) OR ${schema.conversations.lastMessageAt} IS NULL)`);
        } else {
          conditions.push(sql`(${schema.conversations.lastMessageAt} > ${new Date(cursor.value!)} OR (${schema.conversations.lastMessageAt} = ${new Date(cursor.value!)} AND ${schema.conversations.id} > ${cursor.id}))`);
        }
      } else {
        const value = input.sortBy === 'createdAt' ? new Date(cursor.value!) : cursor.value!;
        conditions.push(sql`(${sortColumn} ${after} ${value} OR (${sortColumn} = ${value} AND ${schema.conversations.id} ${after} ${cursor.id}))`);
      }
    }
    const sortExpression = input.sortBy === 'lastMessageAt'
      ? input.sortOrder === 'asc' ? sql`${asc(sortColumn)} NULLS FIRST` : sql`${desc(sortColumn)} NULLS LAST`
      : input.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);
    const rows = await this.db
      .select({
        id: schema.conversations.id,
        title: schema.conversations.title,
        createdBy: schema.conversations.createdBy,
        messageCount: schema.conversations.messageCount,
        lastMessageAt: schema.conversations.lastMessageAt,
        isArchived: schema.conversations.isArchived,
        isShared: schema.conversations.isShared,
        isGroup: schema.conversations.isGroup,
        unseenMentionCount: sql<number>`(SELECT count(*)::int FROM conversation.conversation_member_mentions mm WHERE mm.conversation_id = ${schema.conversations.id} AND mm.user_id = ${input.userId} AND mm.seen_at IS NULL)`,
        projectId: schema.conversations.projectId,
        runtimeMode: schema.conversations.runtimeMode,
        runtimePurpose: schema.conversations.runtimePurpose,
        pinnedAgentId: schema.conversations.pinnedAgentId,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversations)
      .where(and(...conditions))
      .orderBy(sortExpression, input.sortOrder === 'asc' ? asc(schema.conversations.id) : desc(schema.conversations.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const records = page.map((row) => ({
      ...row,
      id: row.id.trim(),
      createdBy: row.createdBy.trim(),
      projectId: row.projectId?.trim() ?? null,
      pinnedAgentId: row.pinnedAgentId?.trim() ?? null,
      runtimeMode: row.runtimeMode as ConversationRecord['runtimeMode'],
      runtimePurpose: row.runtimePurpose as ConversationRecord['runtimePurpose'],
      lastMessageAt: row.lastMessageAt ?? undefined,
    }));
    const last = records.at(-1);
    const value = last
      ? input.sortBy === 'title'
        ? last.title
        : input.sortBy === 'createdAt'
          ? last.createdAt.toISOString()
          : last.lastMessageAt?.toISOString() ?? null
      : null;
    return {
      records,
      hasMore,
      nextCursor: hasMore && last ? encodeConversationCursor({
        v: 1,
        s: input.sortBy,
        d: input.sortOrder,
        n: input.sortBy === 'lastMessageAt' && !last.lastMessageAt ? 1 : 0,
        value,
        id: last.id,
        f: filterHash,
      }) : null,
    };
  }

  async updateOwned(
    id: string,
    ownerId: string,
    patch: Partial<
      Pick<
        ConversationRecord,
        | 'title'
        | 'isArchived'
        | 'workspaces'
        | 'selectedSkills'
        | 'projectId'
        | 'isFirstMessage'
        | 'groupTaggedAgentIds'
        | 'members'
        | 'invitedUsers'
        | 'isGroup'
      >
    >,
  ): Promise<ConversationRecord | null> {
    const exists = await this.findById(id, true);
    if (!exists || exists.createdBy !== ownerId) return null;
    await this.db.transaction(async (tx) => {
      const base = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
        ...(patch.isFirstMessage !== undefined ? { isFirstMessage: patch.isFirstMessage } : {}),
        ...(patch.isGroup !== undefined ? { isGroup: patch.isGroup } : {}),
        updatedAt: new Date(),
      };
      await tx
        .update(schema.conversations)
        .set(base)
        .where(and(eq(schema.conversations.id, id), eq(schema.conversations.createdBy, ownerId)));
      if (patch.workspaces)
        await this.replaceOrdered(tx, schema.conversationWorkspaces, id, patch.workspaces);
      if (patch.selectedSkills)
        await this.replaceOrdered(tx, schema.conversationSelectedSkills, id, patch.selectedSkills);
      if (patch.groupTaggedAgentIds)
        await this.replaceOrdered(
          tx,
          schema.conversationGroupTaggedAgents,
          id,
          patch.groupTaggedAgentIds,
        );
      if (patch.members) {
        await tx
          .delete(schema.conversationGroupMembers)
          .where(eq(schema.conversationGroupMembers.conversationId, id));
        if (patch.members.length)
          await tx.insert(schema.conversationGroupMembers).values(
            patch.members.map((member, position) => ({
              conversationId: id,
              userId: member.userId,
              position,
              joinedAt: member.joinedAt,
              status: member.status,
              job: member.job,
            })),
          );
      }
      if (patch.invitedUsers) {
        await tx
          .delete(schema.conversationGroupInvites)
          .where(eq(schema.conversationGroupInvites.conversationId, id));
        if (patch.invitedUsers.length)
          await tx.insert(schema.conversationGroupInvites).values(
            patch.invitedUsers.map((invite, position) => ({
              conversationId: id,
              position,
              email: invite.email,
              normalizedEmail: invite.email.trim().toLowerCase(),
              status: invite.status,
              invitedAt: invite.invitedAt,
              job: invite.job,
            })),
          );
      }
    });
    return this.findById(id, true);
  }

  async deleteOwned(id: string, ownerId: string): Promise<ConversationRecord | null> {
    const record = await this.findById(id, true);
    if (!record || record.createdBy !== ownerId) return null;
    await this.db
      .delete(schema.conversations)
      .where(and(eq(schema.conversations.id, id), eq(schema.conversations.createdBy, ownerId)));
    return record;
  }

  async setSystemWorkspace(id: string, workspaceId: string): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({ systemWorkspaceId: workspaceId, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id));
  }

  async joinGroup(
    id: string,
    userId: string,
    email: string,
    joinedAt: Date,
  ): Promise<ConversationRecord | null> {
    const hasInvitation = await this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.id, id), eq(schema.conversations.isGroup, true)))
        .for('update')
        .limit(1);
      if (!conversation) return false;
      const [invite] = await tx
        .select()
        .from(schema.conversationGroupInvites)
        .where(
          and(
            eq(schema.conversationGroupInvites.conversationId, id),
            eq(schema.conversationGroupInvites.normalizedEmail, email.trim().toLowerCase()),
          ),
        )
        .for('update')
        .limit(1);
      if (!invite) return false;
      const [member] = await tx
        .select({ userId: schema.conversationGroupMembers.userId })
        .from(schema.conversationGroupMembers)
        .where(
          and(
            eq(schema.conversationGroupMembers.conversationId, id),
            eq(schema.conversationGroupMembers.userId, userId),
          ),
        )
        .limit(1);
      if (!member) {
        const [position] = await tx
          .select({
            value: sql<number>`COALESCE(max(${schema.conversationGroupMembers.position}), -1)::int + 1`,
          })
          .from(schema.conversationGroupMembers)
          .where(eq(schema.conversationGroupMembers.conversationId, id));
        await tx.insert(schema.conversationGroupMembers).values({
          conversationId: id,
          userId,
          position: position?.value ?? 0,
          joinedAt,
          status: 'member',
          job: invite.job,
        });
        await tx
          .delete(schema.conversationGroupInvites)
          .where(
            and(
              eq(schema.conversationGroupInvites.conversationId, id),
              eq(schema.conversationGroupInvites.normalizedEmail, email.trim().toLowerCase()),
            ),
          );
        await tx
          .update(schema.conversations)
          .set({ lastMessageAt: joinedAt, updatedAt: joinedAt })
          .where(eq(schema.conversations.id, id));
      }
      return true;
    });
    return hasInvitation ? this.findById(id, true) : null;
  }

  async removeMember(id: string, memberId: string): Promise<ConversationRecord | null> {
    await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ userId: schema.conversationGroupMembers.userId })
        .from(schema.conversationGroupMembers)
        .where(
          and(
            eq(schema.conversationGroupMembers.conversationId, id),
            eq(schema.conversationGroupMembers.userId, memberId),
          ),
        )
        .for('update')
        .limit(1);
      if (!member) return;
      await tx
        .delete(schema.conversationMemberMentions)
        .where(
          and(
            eq(schema.conversationMemberMentions.conversationId, id),
            eq(schema.conversationMemberMentions.userId, memberId),
          ),
        );
      await tx
        .delete(schema.conversationGroupMembers)
        .where(
          and(
            eq(schema.conversationGroupMembers.conversationId, id),
            eq(schema.conversationGroupMembers.userId, memberId),
          ),
        );
    });
    return this.findById(id, true);
  }
  async updateMemberJob(
    id: string,
    memberId: string,
    job: string,
  ): Promise<ConversationRecord | null> {
    const rows = await this.db
      .update(schema.conversationGroupMembers)
      .set({ job })
      .where(
        and(
          eq(schema.conversationGroupMembers.conversationId, id),
          eq(schema.conversationGroupMembers.userId, memberId),
        ),
      )
      .returning({ userId: schema.conversationGroupMembers.userId });
    return rows.length ? this.findById(id, true) : null;
  }
  async touchMessage(id: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(schema.conversations)
      .set({
        lastMessageAt: now,
        messageCount: sql`${schema.conversations.messageCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.conversations.id, id));
  }

  async addGroupTaggedAgents(id: string, agentIds: string[]): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.id, id), eq(schema.conversations.isGroup, true)))
        .for('update')
        .limit(1);
      if (!conversation) return [];
      const rows = await tx
        .select({ value: schema.conversationGroupTaggedAgents.value })
        .from(schema.conversationGroupTaggedAgents)
        .where(eq(schema.conversationGroupTaggedAgents.conversationId, id))
        .orderBy(schema.conversationGroupTaggedAgents.position);
      const existing = rows.map((row) => row.value.trim());
      const added = [...new Set(agentIds)].filter((agentId) => !existing.includes(agentId));
      if (added.length)
        await this.replaceOrdered(tx, schema.conversationGroupTaggedAgents, id, [
          ...existing,
          ...added,
        ]);
      return added;
    });
  }
  async replaceTaggedAgentIds(id: string, agentIds: string[]): Promise<void> {
    if (!agentIds.length) return;
    await this.db.transaction((tx) =>
      this.replaceOrdered(tx, schema.conversationTaggedAgents, id, agentIds),
    );
  }
  async updateInternal(
    id: string,
    patch: { title?: string; isArchived?: boolean; isFirstMessage?: boolean },
  ): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id));
  }
  async getWorkspaceIds(
    id: string,
  ): Promise<{ workspaces: string[]; systemWorkspaceId?: string } | null> {
    const record = await this.findById(id, true);
    return record
      ? { workspaces: record.workspaces, systemWorkspaceId: record.systemWorkspaceId }
      : null;
  }
  async findOrphaned(cutoff: Date, limit: number): Promise<ConversationRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.messageCount, 0),
          eq(schema.conversations.isFirstMessage, true),
          eq(schema.conversations.isShared, false),
          lt(schema.conversations.createdAt, cutoff),
        ),
      )
      .limit(limit);
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }
  async markMentionSeen(
    conversationId: string,
    userId: string,
    messageId: string,
    seenAt: Date,
  ): Promise<void> {
    await this.db
      .update(schema.conversationMemberMentions)
      .set({ seenAt })
      .where(
        and(
          eq(schema.conversationMemberMentions.conversationId, conversationId),
          eq(schema.conversationMemberMentions.userId, userId),
          eq(schema.conversationMemberMentions.messageId, messageId),
        ),
      );
  }
  async addMention(conversationId: string, userId: string, messageId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ userId: schema.conversationGroupMembers.userId })
        .from(schema.conversationGroupMembers)
        .where(
          and(
            eq(schema.conversationGroupMembers.conversationId, conversationId),
            eq(schema.conversationGroupMembers.userId, userId),
          ),
        )
        .for('update')
        .limit(1);
      if (!member) return;
      const [position] = await tx
        .select({
          value: sql<number>`COALESCE(max(${schema.conversationMemberMentions.position}), -1)::int + 1`,
        })
        .from(schema.conversationMemberMentions)
        .where(
          and(
            eq(schema.conversationMemberMentions.conversationId, conversationId),
            eq(schema.conversationMemberMentions.userId, userId),
          ),
        );
      await tx
        .insert(schema.conversationMemberMentions)
        .values({ conversationId, userId, messageId, position: position?.value ?? 0 });
    });
  }
}
