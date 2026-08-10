import { WorkyPlanningService } from './worky-planning.service';

describe('WorkyPlanningService.appendVoiceMessage', () => {
  it('creates a voice-origin message and emits message.appended', async () => {
    const created = { _id: { toString: () => 'm1' } };
    const messages = { create: jest.fn().mockResolvedValue(created) };
    const events = { emit: jest.fn() };
    const svc = Object.assign(Object.create(WorkyPlanningService.prototype), { messages, events });

    const res = await (svc as WorkyPlanningService).appendVoiceMessage('u1', '507f1f77bcf86cd799439011', 'manager', 'all done');

    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'manager', content: 'all done', origin: 'voice' }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'message.appended' }));
    expect(res).toEqual({ id: 'm1' });
  });
});
