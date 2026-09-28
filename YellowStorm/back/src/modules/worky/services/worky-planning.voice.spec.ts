import { WorkyPlanningService } from './worky-planning.service';

describe('WorkyPlanningService.appendVoiceMessage', () => {
  const ownerId = '507f1f77bcf86cd799439012';
  const streamId = '507f1f77bcf86cd799439011';

  it('creates a voice-origin message and emits message.appended', async () => {
    const messages = { create: jest.fn().mockResolvedValue({ id: 'm1' }) };
    const events = { emit: jest.fn() };
    const streams = { findById: jest.fn().mockResolvedValue({ id: streamId, ownerUserId: ownerId, shares: [] }) };
    const service = new WorkyPlanningService(streams as never, messages as never, events as never);

    const res = await service.appendVoiceMessage(ownerId, streamId, 'manager', 'all done');

    expect(messages.create).toHaveBeenCalledWith({ streamId, role: 'manager', content: 'all done', origin: 'voice' });
    expect(events.emit).toHaveBeenCalledWith(ownerId, streamId, expect.objectContaining({
      type: 'message.appended',
      payload: { id: 'm1', role: 'manager', content: 'all done' },
    }));
    expect(res).toEqual({ id: 'm1' });
  });

  it('does not store a voice message for a user without write access', async () => {
    const messages = { create: jest.fn() };
    const streams = { findById: jest.fn().mockResolvedValue({ id: streamId, ownerUserId: ownerId, shares: [] }) };
    const service = new WorkyPlanningService(streams as never, messages as never, { emit: jest.fn() } as never);

    await expect(service.appendVoiceMessage('507f1f77bcf86cd799439013', streamId, 'owner', 'hi')).rejects.toMatchObject({ code: 'ERR_3500' });
    expect(messages.create).not.toHaveBeenCalled();
  });
});
