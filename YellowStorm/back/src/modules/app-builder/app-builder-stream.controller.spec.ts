import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AppBuilderStreamController } from './app-builder-stream.controller';
import { AppBuilderSessionService } from './services/app-builder-session.service';
import { AppBuilderSessionAccessService } from './services/app-builder-session-access.service';
import { AppBuilderEventStoreService } from './services/app-builder-event-store.service';
import { AppBuilderStreamGatewayService } from './services/app-builder-stream-gateway.service';
import { AppBuilderStreamService } from './services/app-builder-stream.service';
import { AppBuilderOwnerGuard } from './guards/app-builder-owner.guard';
import { SseAuthGuard } from '@modules/conversation/guards/stream-auth.guard';

const config = new Map<string, unknown>([['appBuilder.sseHeartbeatMs', 100]]);

class FakeRes {
  written: string[] = [];
  closed = false;
  socket = { setNoDelay: jest.fn() };
  setHeader = jest.fn();
  flushHeaders = jest.fn();
  write = (chunk: string) => {
    this.written.push(chunk);
    return true;
  };
  end = () => {
    this.closed = true;
  };
  private handlers: Record<string, () => void> = {};
  on = jest.fn((evt: string, cb: () => void) => {
    this.handlers[evt] = cb;
  });
  fireClose() {
    this.handlers.close?.();
  }
}

describe('AppBuilderStreamController', () => {
  let controller: AppBuilderStreamController;
  let gateway: { registerConnection: jest.Mock; removeConnection: jest.Mock };
  let streamService: { startStream: jest.Mock };

  beforeEach(async () => {
    gateway = {
      registerConnection: jest.fn().mockReturnValue(true),
      removeConnection: jest.fn(),
    };
    streamService = { startStream: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppBuilderStreamController],
      providers: [
        { provide: ConfigService, useValue: { get: (k: string) => config.get(k) } },
        { provide: AppBuilderSessionService, useValue: { getOne: jest.fn(), getById: jest.fn() } },
        { provide: AppBuilderSessionAccessService, useValue: { resolveSession: jest.fn() } },
        { provide: AppBuilderEventStoreService, useValue: { listSince: jest.fn() } },
        { provide: AppBuilderStreamGatewayService, useValue: gateway },
        { provide: AppBuilderStreamService, useValue: streamService },
      ],
    })
      .overrideGuard(SseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AppBuilderOwnerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(AppBuilderStreamController);
  });

  it('registers the per-user pipe and writes a connected frame', async () => {
    const res = new FakeRes();
    const done = controller.streamPipe({ id: 'u1' } as never, res as unknown as Response);
    // The pipe stays open until the response closes.
    expect(gateway.registerConnection).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
      res,
    );
    expect(res.written.some((f) => f.startsWith('event: connected'))).toBe(true);
    res.fireClose();
    await done;
    expect(gateway.removeConnection).toHaveBeenCalled();
    expect(res.closed).toBe(true);
  });

  it('rejects the pipe when the gateway is at capacity', async () => {
    gateway.registerConnection.mockReturnValue(false);
    const res = new FakeRes();
    await controller.streamPipe({ id: 'u1' } as never, res as unknown as Response);
    expect(res.written.some((f) => f.startsWith('event: error'))).toBe(true);
    expect(res.closed).toBe(true);
  });

  it('kicks off a background stream on POST message and returns accepted', async () => {
    const result = await controller.sendMessage({ id: 'u1' }, 's1', {
      message: 'hi',
      model: 'azure/gpt-4.1',
    } as never);
    expect(streamService.startStream).toHaveBeenCalledWith(
      'u1',
      's1',
      expect.objectContaining({ message: 'hi', model: 'azure/gpt-4.1' }),
    );
    expect(result).toEqual({ accepted: true });
  });

  it('forwards connector repo context to the stream service', async () => {
    await controller.sendMessage({ id: 'u1' }, 's1', {
      message: 'do it',
      connectorId: 'c1',
      connectorName: 'GitHub',
      connectorRepoId: 'r1',
      connectorRepoName: 'org/repo',
      connectorRepoUrl: 'https://github.com/org/repo',
    } as never);
    expect(streamService.startStream).toHaveBeenCalledWith(
      'u1',
      's1',
      expect.objectContaining({
        connectorRepo: expect.objectContaining({ connectorId: 'c1', repoId: 'r1' }),
      }),
    );
  });
});
