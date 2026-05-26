import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Subject } from 'rxjs';
import { Response } from 'express';
import { ConversationV2StreamController } from './conversation-v2-stream.controller';
import { ConversationV2GrpcClientService } from './services/conversation-v2.grpc-client.service';
import { ConversationV2PointerWriterService } from './services/conversation-v2-pointer-writer.service';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { ConversationV2Event } from './types/conversation-v2.types';
import { SseAuthGuard } from '@modules/conversation/guards/stream-auth.guard';

const config = new Map<string, unknown>([
  ['conversationV2.sseHeartbeatMs', 100],
  ['conversationV2.maxMessageLength', 16384],
]);

class FakeRes {
  headersSent = false;
  written: string[] = [];
  closed = false;
  setHeader = jest.fn();
  flushHeaders = jest.fn();
  write = (chunk: string) => { this.written.push(chunk); return true; };
  end = () => { this.closed = true; };
  on = jest.fn();
}

describe('ConversationV2StreamController', () => {
  let controller: ConversationV2StreamController;
  let grpcClient: { chat: jest.Mock };
  let stream$: Subject<ConversationV2Event>;

  beforeEach(async () => {
    stream$ = new Subject();
    grpcClient = { chat: jest.fn(() => stream$.asObservable()) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationV2StreamController],
      providers: [
        { provide: ConversationV2GrpcClientService, useValue: grpcClient },
        { provide: ConfigService, useValue: { get: (k: string) => config.get(k) } },
        { provide: ConversationV2PointerWriterService, useValue: { apply: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConversationV2SessionService, useValue: { createForUser: jest.fn().mockResolvedValue({}) } },
      ],
    })
      .overrideGuard(SseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ConversationV2StreamController);
  });

  it('sets SSE headers and writes one frame per event', async () => {
    const res = new FakeRes() as unknown as Response;
    const done = controller.stream({ id: 'u1' } as any, 's1', { message: 'hi' }, res);
    stream$.next({ type: 'title', payload: { event_id: 'e1', timestamp: 1, title: 't' } });
    stream$.next({ type: 'message', payload: { event_id: 'e2', timestamp: 1, role: 'assistant', content: 'hi', attachments: [] } });
    stream$.next({ type: 'done', payload: { event_id: 'e3', timestamp: 1 } });
    stream$.complete();
    await done;
    const frames = (res as unknown as FakeRes).written.filter((s) => !s.startsWith(':'));
    expect(frames.map((f) => f.split('\n')[0])).toEqual(['event: title', 'event: message', 'event: done']);
    expect((res as unknown as FakeRes).closed).toBe(true);
  });

  it('cancels the gRPC observable when the response closes', async () => {
    const res = new FakeRes();
    let closeCb: Function = () => undefined;
    res.on = jest.fn((evt: string, cb: Function) => { if (evt === 'close') closeCb = cb; });
    const done = controller.stream({ id: 'u1' } as any, 's1', { message: 'hi' }, res as unknown as Response);
    closeCb();
    stream$.complete();
    await done;
    expect(res.closed).toBe(true);
  });
});
