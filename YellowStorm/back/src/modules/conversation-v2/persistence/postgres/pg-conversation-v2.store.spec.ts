import { eq } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import type { ConversationV2Event } from '../../types/conversation-v2.types';
import { PgConversationV2SessionStore } from './pg-conversation-v2-session.store';
import { PgConversationV2EventStore } from './pg-conversation-v2-event.store';
import { PgConversationV2AppShareStore } from './pg-conversation-v2-app-share.store';

describeIntegration('PgConversationV2 stores (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const sessions = new PgConversationV2SessionStore(db as never);
  const events = new PgConversationV2EventStore(db as never, sessions);
  const shares = new PgConversationV2AppShareStore(db as never);
  const sessionIds: string[] = [];

  const wireMessage = (eventId: string, content = 'hi'): ConversationV2Event =>
    ({
      type: 'message',
      payload: {
        event_id: eventId,
        timestamp: Math.floor(Date.now() / 1000),
        role: 'assistant',
        content,
        attachments: [],
      },
    }) as ConversationV2Event;

  afterEach(async () => {
    const ids = sessionIds.splice(0);
    for (const id of ids) {
      await db.delete(schema.conversationV2Sessions).where(eq(schema.conversationV2Sessions.id, id));
    }
  });

  afterAll(async () => {
    await close();
  });

  it('createDraft → listByOwner → softDelete hides session but keeps events', async () => {
    const ownerId = oid();
    const draft = await sessions.createDraft(ownerId, []);
    sessionIds.push(draft.id);

    const first = await events.append(draft.id, wireMessage('evt-keep-1'));
    expect(first.inserted).toBe(true);

    const listed = await sessions.listByOwner({ ownerId, limit: 20 });
    expect(listed.map((s) => s.id)).toContain(draft.id);

    const soft = await sessions.softDelete(ownerId, draft.id);
    expect(soft?.deletedAt).not.toBeNull();

    const afterSoft = await sessions.listByOwner({ ownerId, limit: 20 });
    expect(afterSoft.map((s) => s.id)).not.toContain(draft.id);

    const byId = await sessions.findById(draft.id, { includeDeleted: true });
    expect(byId?.deletedAt).not.toBeNull();

    const kept = await events.listSince(draft.id, 0, 10);
    expect(kept).toHaveLength(1);
    expect(kept[0].eventId).toBe('evt-keep-1');
  });

  it('append dedupes by event_id and leaves a wasted sequence slot on conflict', async () => {
    const ownerId = oid();
    const draft = await sessions.createDraft(ownerId, []);
    sessionIds.push(draft.id);

    const a = await events.append(draft.id, wireMessage('same-id'));
    expect(a).toEqual({ sequence: 1, inserted: true });

    const b = await events.append(draft.id, wireMessage('same-id', 'retry'));
    expect(b.inserted).toBe(false);
    expect(b.sequence).toBe(1);

    const rows = await events.listSince(draft.id, 0, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].sequence).toBe(1);

    const pointer = await sessions.findById(draft.id);
    // counters were bumped twice even though only one row exists
    expect(pointer?.eventSequence).toBe(2);
    expect(pointer?.eventCount).toBe(2);
  });

  it('concurrent appends assign distinct sequences without unique violations', async () => {
    const ownerId = oid();
    const draft = await sessions.createDraft(ownerId, []);
    sessionIds.push(draft.id);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => events.append(draft.id, wireMessage(`concurrent-${i}`))),
    );

    expect(results.every((r) => r.inserted)).toBe(true);
    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const rows = await events.listSince(draft.id, 0, 20);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.sequence)).size).toBe(8);
  });

  it('append strips U+0000 from the payload, which jsonb would otherwise reject', async () => {
    const ownerId = oid();
    const draft = await sessions.createDraft(ownerId, []);
    sessionIds.push(draft.id);

    const event = wireMessage('evt-nul', 'before\u0000after');
    (event.payload as unknown as Record<string, unknown>).meta = { 'k\u0000ey': ['a\u0000b', 3] };

    const appended = await events.append(draft.id, event);
    expect(appended.inserted).toBe(true);

    const [row] = await events.listSince(draft.id, 0, 10);
    expect(row.payload).toMatchObject({ content: 'beforeafter', meta: { key: ['ab', 3] } });
  });

  it('app share partial uniques upsert by user and email; invite token is unique', async () => {
    const ownerId = oid();
    const recipientUserId = oid();
    const draft = await sessions.createDraft(ownerId, []);
    sessionIds.push(draft.id);

    const first = await shares.upsertByRecipientUser({
      sessionId: draft.id,
      ownerId,
      recipientUserId,
      title: 'App A',
      deployedUrl: 'https://example.test/a',
      includeConversation: true,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      inviteConsumedAt: null,
    });
    const second = await shares.upsertByRecipientUser({
      sessionId: draft.id,
      ownerId,
      recipientUserId,
      title: 'App A updated',
      deployedUrl: 'https://example.test/a2',
      includeConversation: false,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      inviteConsumedAt: null,
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('App A updated');
    expect(second.includeConversation).toBe(false);

    const emailShare = await shares.upsertByRecipientEmail({
      sessionId: draft.id,
      ownerId,
      recipientEmail: 'Invitee@Example.COM',
      title: 'Pending invite',
      deployedUrl: 'https://example.test/invite',
      includeConversation: true,
      inviteTokenHash: 'invite-hash-1',
      inviteExpiresAt: new Date(Date.now() + 86_400_000),
      inviteConsumedAt: null,
    });
    expect(emailShare.recipientEmail).toBe('invitee@example.com');

    const again = await shares.upsertByRecipientEmail({
      sessionId: draft.id,
      ownerId,
      recipientEmail: 'invitee@example.com',
      title: 'Pending invite 2',
      deployedUrl: 'https://example.test/invite2',
      includeConversation: true,
      inviteTokenHash: 'invite-hash-1',
      inviteExpiresAt: new Date(Date.now() + 86_400_000),
      inviteConsumedAt: null,
    });
    expect(again.id).toBe(emailShare.id);

    const other = await sessions.createDraft(ownerId, []);
    sessionIds.push(other.id);
    await expect(
      shares.upsertByRecipientEmail({
        sessionId: other.id,
        ownerId,
        recipientEmail: 'other@example.com',
        title: 'Clash',
        deployedUrl: 'https://example.test/clash',
        includeConversation: true,
        inviteTokenHash: 'invite-hash-1',
        inviteExpiresAt: new Date(Date.now() + 86_400_000),
        inviteConsumedAt: null,
      }),
    ).rejects.toThrow();
  });
});
