import { Types } from 'mongoose';
import { WorkyPlanningService } from './worky-planning.service';

describe('WorkyPlanningService.listMessages', () => {
  it('returns the newest limited window in chronological order with its components', async () => {
    const streamId = new Types.ObjectId().toString();
    const oldId = new Types.ObjectId();
    const newId = new Types.ObjectId();
    const docs = [
      { _id: newId, externalId: 'new', role: 'manager', content: 'New', createdAt: new Date('2026-09-23T10:00:00Z') },
      { _id: oldId, externalId: 'old', role: 'owner', content: 'Old', createdAt: new Date('2026-09-23T09:00:00Z') },
    ];
    const messagesQuery = {
      sort: jest.fn(), limit: jest.fn(), lean: jest.fn(), exec: jest.fn().mockResolvedValue(docs),
    };
    messagesQuery.sort.mockReturnValue(messagesQuery);
    messagesQuery.limit.mockReturnValue(messagesQuery);
    messagesQuery.lean.mockReturnValue(messagesQuery);
    const componentQuery = {
      sort: jest.fn(), lean: jest.fn(), exec: jest.fn().mockResolvedValue([
        { externalId: 'component-new', messageExternalId: 'new', type: 'choice', data: { questionId: 'confirm::new' } },
      ]),
    };
    componentQuery.sort.mockReturnValue(componentQuery);
    componentQuery.lean.mockReturnValue(componentQuery);
    const svc = Object.assign(Object.create(WorkyPlanningService.prototype), {
      streams: { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ownerUserId: new Types.ObjectId('507f1f77bcf86cd799439011'), shares: [] }) }) },
      messages: { find: jest.fn().mockReturnValue(messagesQuery) },
      messageComponents: { find: jest.fn().mockReturnValue(componentQuery) },
    }) as WorkyPlanningService;

    const result = await svc.listMessages('507f1f77bcf86cd799439011', streamId, 2);

    expect(messagesQuery.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(messagesQuery.limit).toHaveBeenCalledWith(2);
    expect(result.map((message) => message.content)).toEqual(['Old', 'New']);
    expect(result[1].components).toEqual([{ id: 'component-new', type: 'choice', data: { questionId: 'confirm::new' } }]);
  });
});
