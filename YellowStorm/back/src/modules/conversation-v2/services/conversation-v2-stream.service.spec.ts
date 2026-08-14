import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Subject } from 'rxjs';
import { ConversationV2StreamService } from './conversation-v2-stream.service';
import { ConversationV2GrpcClientService } from './conversation-v2.grpc-client.service';
import { ConversationV2EventStoreService } from './conversation-v2-event-store.service';
import { ConversationV2PointerWriterService } from './conversation-v2-pointer-writer.service';
import { ConversationV2NameGeneratorService } from './conversation-v2-name-generator.service';
import { ConversationV2SessionService } from './conversation-v2-session.service';
import { ConversationV2SessionAccessService } from './conversation-v2-session-access.service';
import { ConversationV2StreamGatewayService } from './conversation-v2-stream-gateway.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { SkillService } from '@modules/skill/skill.service';
import { ConnectorService } from '@modules/connector/connector.service';
import type { ConversationV2Event } from '../types/conversation-v2.types';

const config = new Map<string, unknown>([
  ['conversationV2.maxMessageLength', 16384],
  ['conversationV2.maxConcurrentStreams', 5],
  ['conversationV2.grpcIdleTimeoutMs', 120000],
]);

const flush = () => new Promise((r) => setImmediate(r));

describe('ConversationV2StreamService', () => {
  let service: ConversationV2StreamService;
  let chat$: Subject<ConversationV2Event>;
  let gateway: { sendToUser: jest.Mock };
  let eventStore: { append: jest.Mock; tagModel: jest.Mock };

  const pointer = {
    aiSessionId: 'ai-1',
    eventCount: 5, // not the first message → no name generation
    systemWorkspaceId: null,
  };

  beforeEach(async () => {
    chat$ = new Subject();
    let seq = 0;
    gateway = { sendToUser: jest.fn() };
    eventStore = {
      append: jest.fn().mockImplementation(async () => ({ sequence: ++seq, inserted: true })),
      tagModel: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationV2StreamService,
        { provide: ConfigService, useValue: { get: (k: string) => config.get(k) } },
        { provide: ConversationV2GrpcClientService, useValue: { chat: jest.fn(() => chat$.asObservable()) } },
        { provide: ConversationV2EventStoreService, useValue: eventStore },
        { provide: ConversationV2PointerWriterService, useValue: { apply: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConversationV2NameGeneratorService, useValue: { generate: jest.fn().mockResolvedValue(null) } },
        {
          provide: ConversationV2SessionAccessService,
          useValue: {
            resolveSession: jest.fn().mockImplementation(async (userId: string) => ({
              ownerId: userId,
              actorUserId: userId,
              pointer,
              access: { sessionId: 's1', viewerRole: 'owner', permissions: [] },
            })),
          },
        },
        {
          provide: ConversationV2SessionService,
          useValue: {
            getOne: jest.fn().mockResolvedValue(pointer),
            setSelectedSkills: jest.fn().mockResolvedValue(undefined),
            setSelectedConnectors: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ConversationV2StreamGatewayService, useValue: gateway },
        { provide: WorkspaceDocumentService, useValue: { createFromAiArtifact: jest.fn() } },
        { provide: SkillService, useValue: { findByIdsForGrpc: jest.fn().mockResolvedValue([]) } },
        { provide: ConnectorService, useValue: { findByIdsForGrpc: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get(ConversationV2StreamService);
  });

  afterEach(() => {
    // Clear any idle timers left by streams that never completed (e.g. the
    // concurrency test) so the jest worker can exit cleanly.
    service.onModuleDestroy();
  });

  it('pushes the user message then each gRPC event, tagged with sessionId', async () => {
    await service.startStream('u1', 's1', { message: 'hi' });

    chat$.next({
      type: 'message',
      payload: { event_id: 'a1', timestamp: 1, role: 'assistant', content: 'hello', attachments: [] },
    } as ConversationV2Event);
    chat$.next({ type: 'done', payload: { event_id: 'd1', timestamp: 1 } } as ConversationV2Event);
    chat$.complete();
    await flush();

    const pushed = gateway.sendToUser.mock.calls.map((c) => c[1]);
    // user echo + assistant message + done
    expect(pushed.map((e) => e.type)).toEqual(['message', 'message', 'done']);
    // every frame carries the sessionId for client-side routing
    expect(pushed.every((e) => e.data.sessionId === 's1')).toBe(true);
    expect(pushed[0].data.role).toBe('user');
    expect(pushed[1].data.role).toBe('assistant');
  });

  it('persists and pushes app_build_progress events', async () => {
    await service.startStream('u1', 's1', { message: 'build app' });

    chat$.next({
      type: 'app_build_progress',
      payload: { event_id: 'p1', timestamp: 1, phase: 'creating_files', message: 'Creating files' },
    } as ConversationV2Event);
    await flush();

    expect(eventStore.append).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ type: 'app_build_progress' }),
    );
    const pushed = gateway.sendToUser.mock.calls.map((c) => c[1]);
    expect(pushed.some((e) => e.type === 'app_build_progress')).toBe(true);

    chat$.next({ type: 'done', payload: { event_id: 'd1', timestamp: 2 } } as ConversationV2Event);
    chat$.complete();
    await flush();
  });

  it('ignores heartbeat events — no persistence, no push, but still resets the idle timer', async () => {
    await service.startStream('u1', 's1', { message: 'hi' });

    chat$.next({ type: 'heartbeat', payload: { event_id: 'h1', timestamp: 1 } } as ConversationV2Event);
    await flush();

    // only the optimistic user-message echo went out — the heartbeat produced nothing
    const pushed = gateway.sendToUser.mock.calls.map((c) => c[1]);
    expect(pushed.map((e) => e.type)).toEqual(['message']);
    expect(eventStore.append).toHaveBeenCalledTimes(1); // just the user message
    expect(service.isStreaming('u1', 's1')).toBe(true); // turn is still alive

    chat$.next({ type: 'done', payload: { event_id: 'd1', timestamp: 1 } } as ConversationV2Event);
    chat$.complete();
    await flush();
    expect(service.isStreaming('u1', 's1')).toBe(false);
  });

  it('marks the conversation as streaming until the gRPC stream completes', async () => {
    await service.startStream('u1', 's1', { message: 'hi' });
    expect(service.isStreaming('u1', 's1')).toBe(true);

    chat$.complete();
    await flush();
    expect(service.isStreaming('u1', 's1')).toBe(false);
  });

  it('synthesizes done when gRPC completes without a terminal event', async () => {
    await service.startStream('u1', 's1', { message: 'hi' });

    chat$.complete();
    await flush();

    const pushed = gateway.sendToUser.mock.calls.map((c) => c[1]);
    expect(pushed.map((e) => e.type)).toContain('done');
  });

  it('rejects a second concurrent turn for the same conversation', async () => {
    await service.startStream('u1', 's1', { message: 'first' });
    await expect(service.startStream('u1', 's1', { message: 'second' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONVERSATION_ALREADY_STREAMING' }),
    });
  });

  it('persists + pushes a terminal error when the gRPC stream errors', async () => {
    await service.startStream('u1', 's1', { message: 'hi' });
    chat$.error(new Error('upstream boom'));
    await flush();

    const pushed = gateway.sendToUser.mock.calls.map((c) => c[1]);
    const errorFrame = pushed.find((e) => e.type === 'error');
    expect(errorFrame).toBeTruthy();
    expect(errorFrame.data.error).toBe('upstream boom');
    expect(service.isStreaming('u1', 's1')).toBe(false);
  });
});
