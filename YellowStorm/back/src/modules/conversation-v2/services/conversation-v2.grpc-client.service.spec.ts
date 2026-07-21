import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConversationV2GrpcClientService } from './conversation-v2.grpc-client.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';

const mockGrpcClient = {
  CreateSession: jest.fn(),
  GetSession: jest.fn(),
  StopSession: jest.fn(),
  Chat: jest.fn(),
  close: jest.fn(),
};

jest.mock('@grpc/grpc-js', () => {
  const actual = jest.requireActual('@grpc/grpc-js');
  return {
    ...actual,
    credentials: { createInsecure: jest.fn(() => 'insecure') },
  };
});

jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn(() => ({})),
}));

describe('ConversationV2GrpcClientService', () => {
  let service: ConversationV2GrpcClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationV2GrpcClientService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                'conversationV2.grpcUrl': 'localhost:50051',
                'conversationV2.grpcMaxMessageBytes': 16 * 1024 * 1024,
                'conversationV2.grpcUnaryDeadlineMs': 5000,
                'conversationV2.grpcStreamDeadlineMs': 900000,
              };
              return map[key];
            },
          },
        },
        {
          provide: WorkspaceService,
          useValue: {
            // createSession translates workspaceIds → owner storage paths; with
            // no workspaces selected this resolves to an empty list.
            getStoragePathsByIds: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get(ConversationV2GrpcClientService);
    (service as unknown as { client: typeof mockGrpcClient }).client = mockGrpcClient;
    Object.values(mockGrpcClient).forEach((fn) => (fn as jest.Mock).mockReset?.());
  });

  it('createSession resolves with session_id', async () => {
    mockGrpcClient.CreateSession.mockImplementation(
      (_req, _meta, _opts, cb) => cb(null, { session_id: 'sess-1' }),
    );
    const id = await service.createSession('u1');
    expect(id).toBe('sess-1');
    expect(mockGrpcClient.CreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1' }),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
    );
  });

  it('getSession unwraps events', async () => {
    mockGrpcClient.GetSession.mockImplementation((_req, _meta, _opts, cb) =>
      cb(null, {
        session_id: 's1',
        title: 't',
        status: 'idle',
        is_shared: false,
        events: [],
      }),
    );
    const session = await service.getSession('u1', 's1');
    expect(session.sessionId).toBe('s1');
    expect(session.events).toEqual([]);
  });

  it('chat returns Observable that emits events and completes on done', (done) => {
    const events: unknown[] = [];
    const fakeStream: any = {
      on: jest.fn(),
      cancel: jest.fn(),
    };
    const handlers: Record<string, Function> = {};
    fakeStream.on.mockImplementation((evt: string, cb: Function) => {
      handlers[evt] = cb;
      return fakeStream;
    });
    mockGrpcClient.Chat.mockReturnValue(fakeStream);

    const sub = service.chat('u1', 's1', 'm').subscribe({
      next: (e) => events.push(e),
      complete: () => {
        expect(events.map((e: any) => e.type)).toEqual(['message', 'done']);
        done();
      },
    });

    handlers['data']?.({
      event_id: 'e1',
      timestamp: 1,
      payload: 'message',
      message: { role: 'assistant', content: 'hi', attachments: [] },
    });
    handlers['data']?.({
      event_id: 'e2',
      timestamp: 2,
      payload: 'done',
      done: {},
    });
    handlers['end']?.();

    expect(sub.closed).toBe(true);
  });

  it('chat unsubscribe cancels the gRPC call', () => {
    const fakeStream: any = { on: jest.fn().mockReturnThis(), cancel: jest.fn() };
    mockGrpcClient.Chat.mockReturnValue(fakeStream);
    const sub = service.chat('u1', 's1', 'm').subscribe();
    sub.unsubscribe();
    expect(fakeStream.cancel).toHaveBeenCalled();
  });

  describe('worky', () => {
    it('calls Worky with positional metadata + deadline and resolves accepted', async () => {
      const Worky = jest.fn((_req, _md, _opts, cb) =>
        cb(null, { session_id: 'sess-1', accepted: true }),
      );
      (service as any).client = { Worky };

      const result = await service.worky('user-1', 'sess-1', 'do the thing', {
        model: 'anthropic/claude-sonnet-4-5',
      });

      expect(result).toEqual({ sessionId: 'sess-1', accepted: true });
      const [req, md, opts] = Worky.mock.calls[0];
      expect(req).toMatchObject({ user_id: 'user-1', session_id: 'sess-1', message: 'do the thing', model: 'anthropic/claude-sonnet-4-5' });
      expect(md).toBeDefined();            // grpc.Metadata, passed positionally
      expect(opts).toHaveProperty('deadline');
    });

    it('rejects when Worky errors', async () => {
      (service as any).client = { Worky: (_r: any, _m: any, _o: any, cb: any) => cb(new Error('boom')) };
      await expect(service.worky('u', 's', 'm')).rejects.toThrow('boom');
    });
  });
});
