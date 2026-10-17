import { createHash } from 'node:crypto';
import { MessageService } from './message.service';
import { PostgresMessageStore } from '../persistence/postgres/postgres-message-store';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger';
import { PutOpenUiAppStateDto } from '../dto/openui-app-state.dto';

describe('MessageService private OpenUI drafts', () => {
  const actor = 'a'.repeat(24), conversation = 'b'.repeat(24), message = 'c'.repeat(24);
  const program = 'root = Card([MiniApp("app", "Test", "", [])])';
  const digest = createHash('sha256').update(program).digest('hex');
  let store: { canWriteOpenUiAppState: jest.Mock; findById: jest.Mock; getOpenUiAppState: jest.Mock; putOpenUiAppState: jest.Mock };
  let service: MessageService;
  const dto = (): PutOpenUiAppStateDto => ({ schemaVersion: 1, libraryVersion: 'yellowstorm-miniapp-v1',
    programDigest: digest, expectedRevision: 0, state: { count: 0, flag: false, source: '' } });
  beforeEach(() => {
    store = { canWriteOpenUiAppState: jest.fn().mockResolvedValue(true), findById: jest.fn().mockResolvedValue({
      id: message, conversationId: conversation, conversationType: 'ai', isComplete: true, isStreaming: false,
      components: [{ id: 'text', type: 'text', data: { content: program } }],
    }), getOpenUiAppState: jest.fn().mockResolvedValue(null), putOpenUiAppState: jest.fn().mockResolvedValue({ stateRevision: 1, state: dto().state, updatedAt: new Date() }) };
    service = new MessageService(store as unknown as PostgresMessageStore, undefined!, undefined!, undefined!,
      { get: (_: string, fallback: unknown) => fallback } as ConfigService,
      { setContext: jest.fn() } as unknown as LoggerService, undefined!);
  });
  it('returns revision zero for a new app and server-derived identity/digest on save', async () => {
    expect(await service.getOpenUiAppState(actor, conversation, message, 'text')).toMatchObject({
      stateRevision: 0, state: {}, programDigest: digest, updatedAt: null });
    expect(await service.putOpenUiAppState(actor, conversation, message, 'text', dto())).toMatchObject({ stateRevision: 1, state: dto().state });
    expect(store.putOpenUiAppState).toHaveBeenCalledWith({ actorId: actor, conversationId: conversation,
      sourceMessageId: message, componentId: 'text', programDigest: digest }, 0, dto().state);
  });
  it('denies GET and PUT for project readers, invitees and removed members', async () => {
    store.canWriteOpenUiAppState.mockResolvedValue(false);
    await expect(service.getOpenUiAppState(actor, conversation, message, 'text')).rejects.toMatchObject({ status: 403 });
    await expect(service.putOpenUiAppState(actor, conversation, message, 'text', dto())).rejects.toMatchObject({ status: 403 });
    expect(store.findById).not.toHaveBeenCalled();
  });
  it.each([{ conversationId: 'd'.repeat(24) }, { conversationType: 'user' }, { isComplete: false },
    { isStreaming: true }, { components: [] }])('rejects wrong or unstable source %p', async patch => {
    store.findById.mockResolvedValue({ ...await store.findById(), ...patch });
    await expect(service.getOpenUiAppState(actor, conversation, message, 'text')).rejects.toThrow();
    expect(store.getOpenUiAppState).not.toHaveBeenCalled();
  });
  it('loads a replaced source under its new digest and rejects the old draft identity', async () => {
    const replacement = 'root = Card([MiniApp("replacement", "New", "", [])])';
    const replacementDigest = createHash('sha256').update(replacement).digest('hex');
    const source = await store.findById();
    store.findById.mockResolvedValue({ ...source, components: [{ id: 'text', type: 'text', data: { content: replacement } }] });
    expect(await service.getOpenUiAppState(actor, conversation, message, 'text')).toMatchObject({
      stateRevision: 0, state: {}, programDigest: replacementDigest });
    expect(store.getOpenUiAppState).toHaveBeenCalledWith({ actorId: actor, conversationId: conversation,
      sourceMessageId: message, componentId: 'text', programDigest: replacementDigest });
    await expect(service.putOpenUiAppState(actor, conversation, message, 'text', dto())).rejects.toMatchObject({ status: 409 });
    expect(store.putOpenUiAppState).not.toHaveBeenCalled();
  });
  it('rejects stale programs and CAS conflicts without silently retrying', async () => {
    await expect(service.putOpenUiAppState(actor, conversation, message, 'text', { ...dto(), programDigest: '0'.repeat(64) })).rejects.toMatchObject({ status: 409 });
    expect(store.putOpenUiAppState).not.toHaveBeenCalled();
    store.putOpenUiAppState.mockResolvedValue(null);
    await expect(service.putOpenUiAppState(actor, conversation, message, 'text', dto())).rejects.toMatchObject({ status: 409 });
    expect(store.putOpenUiAppState).toHaveBeenCalledTimes(1);
  });
});
