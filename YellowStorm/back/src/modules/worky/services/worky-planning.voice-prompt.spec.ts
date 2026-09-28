import { newObjectId } from '@common/postgres';
import { WorkyPlanningService } from './worky-planning.service';
import type { WorkyStreamRecord } from '../worky.types';

const ownerId = newObjectId();
const streamId = newObjectId();

function makeService(stream: Partial<WorkyStreamRecord> | null) {
  const record = stream && ({ id: streamId, ownerUserId: ownerId, shares: [], voicePrompt: null, ...stream } as WorkyStreamRecord);
  const streams = {
    findById: jest.fn().mockResolvedValue(record),
    update: jest.fn(async (_id: string, patch: Partial<WorkyStreamRecord>) => record && { ...record, ...patch }),
  };
  const service = new WorkyPlanningService(streams as never, {} as never, { emit: jest.fn() } as never);
  return { service, streams };
}

describe('WorkyPlanningService voice prompt', () => {
  it('getVoicePrompt returns the stored value', async () => {
    const { service } = makeService({ voicePrompt: 'be terse' });
    await expect(service.getVoicePrompt(ownerId, streamId)).resolves.toEqual({ prompt: 'be terse' });
  });

  it('getVoicePrompt returns null when unset', async () => {
    const { service } = makeService({ voicePrompt: null });
    await expect(service.getVoicePrompt(ownerId, streamId)).resolves.toEqual({ prompt: null });
  });

  it('setVoicePrompt trims and saves a non-empty prompt', async () => {
    const { service, streams } = makeService({ voicePrompt: null });
    const res = await service.setVoicePrompt(ownerId, streamId, '  hello  ');
    expect(streams.update).toHaveBeenCalledWith(streamId, { voicePrompt: 'hello' });
    expect(res).toEqual({ prompt: 'hello' });
  });

  it('setVoicePrompt stores null for blank (reset to default)', async () => {
    const { service, streams } = makeService({ voicePrompt: 'old' });
    const res = await service.setVoicePrompt(ownerId, streamId, '   ');
    expect(streams.update).toHaveBeenCalledWith(streamId, { voicePrompt: null });
    expect(res).toEqual({ prompt: null });
  });

  it('setVoicePrompt does not write an unchanged prompt', async () => {
    const { service, streams } = makeService({ voicePrompt: 'same' });
    const res = await service.setVoicePrompt(ownerId, streamId, ' same ');
    expect(streams.update).not.toHaveBeenCalled();
    expect(res).toEqual({ prompt: 'same' });
  });

  it('setVoicePrompt needs write access; a read share only reads it', async () => {
    const reader = newObjectId();
    const { service, streams } = makeService({
      voicePrompt: 'be terse',
      shares: [{ id: newObjectId(), streamId, userId: reader, permission: 'read', createdAt: new Date(), updatedAt: new Date() }],
    });

    await expect(service.getVoicePrompt(reader, streamId)).resolves.toEqual({ prompt: 'be terse' });
    await expect(service.setVoicePrompt(reader, streamId, 'louder')).rejects.toMatchObject({ code: 'ERR_3500' });
    expect(streams.update).not.toHaveBeenCalled();
  });

  it('answers not found for a missing stream', async () => {
    const { service } = makeService(null);
    await expect(service.getVoicePrompt(ownerId, streamId)).rejects.toMatchObject({ code: 'ERR_3500' });
  });
});
