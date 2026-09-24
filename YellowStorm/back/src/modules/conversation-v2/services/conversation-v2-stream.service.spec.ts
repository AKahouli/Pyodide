import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { ModelsService } from '@modules/models/models.service';
import { RuntimeFinalizedRevisionService } from '@modules/app-runtime/services/runtime-finalized-revision.service';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { RuntimeBindingService } from '@modules/app-runtime/services/runtime-binding.service';
import type { ConversationV2Event } from '../types/conversation-v2.types';

const config = new Map<string, unknown>([
  ['conversationV2.maxMessageLength', 30000],
  ['conversationV2.maxConcurrentStreams', 5],
  ['conversationV2.grpcIdleTimeoutMs', 120000],
]);

const flush = () => new Promise((r) => setImmediate(r));

describe('ConversationV2StreamService', () => {
  let service: ConversationV2StreamService;
  let chat$: Subject<ConversationV2Event>;
  let grpcClient: { chat: jest.Mock };
  let gateway: { sendToUser: jest.Mock };
  let eventStore: { append: jest.Mock; tagModel: jest.Mock };
  let modelsService: {
    getConversationV2DefaultModel: jest.Mock;
    getModelIdentifier: jest.Mock;
    getDefaultModel: jest.Mock;
  };
  let sessions: {
    getOne: jest.Mock;
    getById: jest.Mock;
    findByAiSessionId: jest.Mock;
    setSelectedSkills: jest.Mock;
    setSelectedConnectors: jest.Mock;
  };
  let finalizedRevisions: { assertFinalized: jest.Mock };
  let runtimeRevisions: { branchRevision: jest.Mock };
  let runtimeBindings: { updateRevision: jest.Mock };

  const pointer = {
    aiSessionId: 'ai-1',
    eventCount: 5, // not the first message → no name generation
    systemWorkspaceId: null,
  };

  beforeEach(async () => {
    chat$ = new Subject();
    let seq = 0;
    grpcClient = { chat: jest.fn(() => chat$.asObservable()) };
    gateway = { sendToUser: jest.fn() };
    eventStore = {
      append: jest.fn().mockImplementation(async () => ({ sequence: ++seq, inserted: true })),
      tagModel: jest.fn().mockResolvedValue(undefined),
    };
    modelsService = {
      getConversationV2DefaultModel: jest.fn().mockResolvedValue(null),
      getModelIdentifier: jest.fn((m: { litellmModel?: string; id?: string } | null) => m?.litellmModel || m?.id || ''),
      getDefaultModel: jest.fn().mockResolvedValue(null),
    };
    sessions = {
      getOne: jest.fn().mockResolvedValue(pointer),
      getById: jest.fn().mockResolvedValue(null),
      findByAiSessionId: jest.fn().mockResolvedValue(null),
      setSelectedSkills: jest.fn().mockResolvedValue(undefined),
      setSelectedConnectors: jest.fn().mockResolvedValue(undefined),
    };
    finalizedRevisions = { assertFinalized: jest.fn().mockResolvedValue(undefined) };
    runtimeRevisions = {
      branchRevision: jest.fn().mockResolvedValue({
        revisionId: 'rev_8',
        workspaceId: 'ai-1',
        parentRevisionId: 'rev_2',
        manifestHash: 'hash',
        manifestObjectKey: 'appbuilder/manifests/ai-1/rev_8.json',
        files: [],
      }),
    };
    runtimeBindings = { updateRevision: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationV2StreamService,
        { provide: ConfigService, useValue: { get: (k: string) => config.get(k) } },
        { provide: ConversationV2GrpcClientService, useValue: grpcClient },
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
        { provide: ConversationV2SessionService, useValue: sessions },
        { provide: ConversationV2StreamGatewayService, useValue: gateway },
        { provide: WorkspaceDocumentService, useValue: { createFromAiArtifact: jest.fn() } },
        { provide: SkillService, useValue: { findByIdsForGrpc: jest.fn().mockResolvedValue([]) } },
        { provide: ConnectorService, useValue: { findByIdsForGrpc: jest.fn().mockResolvedValue([]) } },
        { provide: ModelsService, useValue: modelsService },
        { provide: RuntimeFinalizedRevisionService, useValue: finalizedRevisions },
        { provide: RuntimeRevisionService, useValue: runtimeRevisions },
        { provide: RuntimeBindingService, useValue: runtimeBindings },
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

  it('publishApplicationComponent maps an APImanus workspace id to the YellowStorm pointer', async () => {
    const pointerId = '507f1f77bcf86cd799439011';
    sessions.findByAiSessionId.mockResolvedValueOnce({ id: pointerId });

    await service.publishApplicationComponent('u1', '72e7924c2cc04f5f', {
      event_id: 'app-1',
      timestamp: 1,
      url: 'nodepod://preview',
      title: 'Finance app',
      revision_id: 'rev_8',
    });

    expect(sessions.findByAiSessionId).toHaveBeenCalledWith('72e7924c2cc04f5f');
    expect(eventStore.append).toHaveBeenCalledWith(
      pointerId,
      expect.objectContaining({ type: 'application_component' }),
    );
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        type: 'application_component',
        data: expect.objectContaining({ sessionId: pointerId, revision_id: 'rev_8' }),
      }),
    );
  });

  it('publishApplicationComponent rejects an unknown workspace id', async () => {
    await expect(
      service.publishApplicationComponent('u1', '72e7924c2cc04f5f', {
        event_id: 'app-1',
        timestamp: 1,
        url: 'nodepod://preview',
      }),
    ).rejects.toThrow('Invalid session id 72e7924c2cc04f5f');
    expect(eventStore.append).not.toHaveBeenCalled();
  });

  describe('historical-version send (baseRevisionId)', () => {
    it('validates, branches and pins the binding, then prefixes the agent message', async () => {
      await service.startStream('u1', 's1', {
        message: 'continue from version 2',
        baseRevisionId: 'rev_2',
      });

      expect(finalizedRevisions.assertFinalized).toHaveBeenCalledWith('ai-1', 'rev_2');
      expect(runtimeRevisions.branchRevision).toHaveBeenCalledWith('ai-1', 'rev_2');
      expect(runtimeBindings.updateRevision).toHaveBeenCalledWith('ai-1', 'rev_8');
      const chatMessage = grpcClient.chat.mock.calls[0][2] as string;
      expect(chatMessage).toContain('branched to revision rev_8');
      expect(chatMessage).toContain('revision rev_2');
      expect(chatMessage).toContain('continue from version 2');
    });

    it('rejects a revision that is not finalized before recording the user turn', async () => {
      finalizedRevisions.assertFinalized.mockRejectedValueOnce(
        new BadRequestException('Revision rev_99 is not a finalized version for this app'),
      );

      await expect(
        service.startStream('u1', 's1', { message: 'hi', baseRevisionId: 'rev_99' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(runtimeRevisions.branchRevision).not.toHaveBeenCalled();
      expect(runtimeBindings.updateRevision).not.toHaveBeenCalled();
      expect(grpcClient.chat).not.toHaveBeenCalled();
      expect(eventStore.append).not.toHaveBeenCalled();
    });
  });

  describe('conversation-v2 default model resolution', () => {
    const chatModelArg = (): unknown => grpcClient.chat.mock.calls[0][3];

    it('uses the explicit per-message model when provided', async () => {
      await service.startStream('u1', 's1', { message: 'hi', model: 'azure/gpt-4.1' });

      expect(chatModelArg()).toBe('azure/gpt-4.1');
      expect(modelsService.getConversationV2DefaultModel).not.toHaveBeenCalled();
      expect(modelsService.getDefaultModel).not.toHaveBeenCalled();
    });

    it('falls back to the conversation-v2 default model identifier when no model is provided', async () => {
      modelsService.getConversationV2DefaultModel.mockResolvedValue({
        id: 'deepseek-v4-flash',
        litellmModel: 'deepseek/deepseek-v4-flash',
      });

      await service.startStream('u1', 's1', { message: 'hi' });

      expect(modelsService.getConversationV2DefaultModel).toHaveBeenCalled();
      expect(chatModelArg()).toBe('deepseek/deepseek-v4-flash');
    });

    it('falls back to the global default when no conversation-v2 default is set', async () => {
      modelsService.getConversationV2DefaultModel.mockResolvedValue(null);
      modelsService.getDefaultModel.mockResolvedValue({
        id: 'gpt-4o-mini',
        litellmModel: 'openai/gpt-4o-mini',
      });

      await service.startStream('u1', 's1', { message: 'hi' });

      expect(chatModelArg()).toBe('openai/gpt-4o-mini');
    });

    it('degrades to the legacy behaviour (no model) when the default lookup fails', async () => {
      modelsService.getConversationV2DefaultModel.mockRejectedValue(new Error('mongo down'));

      await service.startStream('u1', 's1', { message: 'hi' });

      expect(chatModelArg()).toBeUndefined();
    });

    it('tags the first assistant message with the resolved default model', async () => {
      modelsService.getConversationV2DefaultModel.mockResolvedValue({
        id: 'deepseek-v4-flash',
        litellmModel: 'deepseek/deepseek-v4-flash',
      });

      await service.startStream('u1', 's1', { message: 'hi' });
      chat$.next({
        type: 'message',
        payload: { event_id: 'a1', timestamp: 1, role: 'assistant', content: 'hello', attachments: [] },
      } as ConversationV2Event);
      await flush();

      expect(eventStore.tagModel).toHaveBeenCalledWith('s1', 'a1', 'deepseek/deepseek-v4-flash');
    });
  });
});
