import { ReportService } from './report.service';

describe('ReportService system correction reports', () => {
  it('reuses an existing system correction report', async () => {
    const existing = {
      _id: { toString: () => 'report-1' },
      conversationId: { toString: () => 'conversation-1' },
      messageId: { toString: () => 'message-1' },
      userId: { toString: () => 'user-1' },
      reason: 'hallucination', description: 'Review', status: 'pending', source: 'system_correction',
      createdAt: new Date('2026-07-26T00:00:00.000Z'), updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    };
    const reportModel = { findOne: jest.fn().mockResolvedValue(existing), create: jest.fn() };
    const service = new ReportService(reportModel as never, {} as never, {} as never, { setContext: jest.fn() } as never);
    await expect(service.createSystemCorrectionReport({ conversationId: '507f1f77bcf86cd799439011', messageId: '507f1f77bcf86cd799439012', userId: '507f1f77bcf86cd799439013' })).resolves.toMatchObject({ id: 'report-1', source: 'system_correction' });
    expect(reportModel.create).not.toHaveBeenCalled();
  });
});
