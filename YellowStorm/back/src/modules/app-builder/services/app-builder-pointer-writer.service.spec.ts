import { Test } from '@nestjs/testing';
import { AppBuilderPointerWriterService } from './app-builder-pointer-writer.service';
import {
  type AppBuilderSessionStore, 
} from '../persistence/app-builder-session.store';
import type { AppBuilderEvent } from '../types/app-builder.types';
import { PgAppBuilderSessionStore } from '../persistence/postgres/pg-app-builder-session.store';

describe('AppBuilderPointerWriterService', () => {
  let svc: AppBuilderPointerWriterService;
  let applyPointerPatch: jest.MockedFunction<AppBuilderSessionStore['applyPointerPatch']>;
  const SESSION_HEX = '507f1f77bcf86cd799439011';

  beforeEach(async () => {
    applyPointerPatch = jest.fn().mockResolvedValue(undefined);
    const mod = await Test.createTestingModule({
      providers: [
        AppBuilderPointerWriterService,
        {
          provide: PgAppBuilderSessionStore,
          useValue: { applyPointerPatch },
        },
      ],
    }).compile();
    svc = mod.get(AppBuilderPointerWriterService);
  });

  function ev(type: AppBuilderEvent['type'], extra: Partial<AppBuilderEvent['payload']> = {}): AppBuilderEvent {
    return {
      type,
      payload: { event_id: 'e1', timestamp: 1700000000, ...extra },
    } as AppBuilderEvent;
  }

  it('TitleEvent updates pointer title', async () => {
    await svc.apply(SESSION_HEX, ev('title', { title: 'My Run' } as any));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ title: 'My Run', lastEventAt: expect.any(Date) }),
    );
  });

  it('TitleEvent with blank title only bumps lastEventAt', async () => {
    await svc.apply(SESSION_HEX, ev('title', { title: '   ' } as any));
    expect(applyPointerPatch).toHaveBeenCalledWith(SESSION_HEX, {
      lastEventAt: expect.any(Date),
    });
  });

  it('DoneEvent flips status to completed', async () => {
    await svc.apply(SESSION_HEX, ev('done'));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('WaitEvent flips status to waiting', async () => {
    await svc.apply(SESSION_HEX, ev('wait'));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ status: 'waiting' }),
    );
  });

  it('ErrorEvent flips status to error', async () => {
    await svc.apply(SESSION_HEX, ev('error', { error: 'boom' } as any));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('user MessageEvent sets status active', async () => {
    await svc.apply(SESSION_HEX, ev('message', { role: 'user', content: 'hi' } as any));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ status: 'active', lastEventAt: expect.any(Date) }),
    );
  });

  it('assistant MessageEvent only bumps lastEventAt', async () => {
    await svc.apply(SESSION_HEX, ev('message', { role: 'assistant', content: 'hi' } as any));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      { lastEventAt: expect.any(Date) },
    );
  });

  it('swallows update errors (best effort)', async () => {
    applyPointerPatch.mockRejectedValueOnce(new Error('postgres down'));
    await expect(svc.apply(SESSION_HEX, ev('done'))).resolves.toBeUndefined();
  });

  it('still delegates when sessionId is not a valid ObjectId hex (store may no-op)', async () => {
    await svc.apply('not-a-hex', ev('done'));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      'not-a-hex',
      expect.objectContaining({ status: 'completed' }),
    );
  });
});
