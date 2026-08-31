import { ReportService } from './report.service';

const now = new Date('2026-07-26T00:00:00.000Z');

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    userId: 'user-1',
    reason: 'hallucination',
    description: 'Review',
    status: 'pending',
    source: 'system_correction',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createService(
  overrides: {
    reportStore?: Record<string, jest.Mock>;
    messageStore?: Record<string, jest.Mock>;
    userService?: Record<string, jest.Mock>;
  } = {},
) {
  const reportStore = {
    findByUserAndMessage: jest.fn(),
    findSystemCorrectionByMessage: jest.fn(),
    create: jest.fn(),
    list: jest.fn(),
    updateStatus: jest.fn(),
    findById: jest.fn(),
    ...overrides.reportStore,
  };
  const messageStore = { findReportMessageById: jest.fn(), ...overrides.messageStore };
  const userService = { findSummaryById: jest.fn(), ...overrides.userService };
  const logger = { setContext: jest.fn(), log: jest.fn() };
  return {
    service: new ReportService(
      reportStore as never,
      messageStore as never,
      userService as never,
      logger as never,
    ),
    reportStore,
    messageStore,
  };
}

describe('ReportService', () => {
  it('reuses an existing system correction report', async () => {
    const existing = report();
    const { service, reportStore } = createService({
      reportStore: { findSystemCorrectionByMessage: jest.fn().mockResolvedValue(existing) },
    });

    await expect(
      service.createSystemCorrectionReport({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ id: 'report-1', source: 'system_correction' });
    expect(reportStore.create).not.toHaveBeenCalled();
  });

  it('reuses a user report after a system-correction uniqueness race', async () => {
    const duplicate = report({ source: 'user' });
    const { service, reportStore } = createService({
      reportStore: {
        findSystemCorrectionByMessage: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(new Error('duplicate')),
        findByUserAndMessage: jest.fn().mockResolvedValue(duplicate),
      },
    });

    await expect(
      service.createSystemCorrectionReport({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ id: 'report-1', source: 'user' });
    expect(reportStore.findByUserAndMessage).toHaveBeenCalledWith('user-1', 'message-1');
  });

  it('creates user reports through the neutral store', async () => {
    const created = report({ reason: 'offensive', source: 'user' });
    const { service, reportStore } = createService({
      reportStore: {
        findByUserAndMessage: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    });

    await expect(
      service.createReport({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        userId: 'user-1',
        reason: 'offensive',
        description: 'Review',
      }),
    ).resolves.toMatchObject({ id: 'report-1', source: 'user' });
    expect(reportStore.create).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      userId: 'user-1',
      reason: 'offensive',
      description: 'Review',
      source: 'user',
    });
  });

  it('resolves the user/AI message pair and reporter through neutral dependencies', async () => {
    const aiMessage = {
      id: 'message-1',
      conversationType: 'ai',
      content: '',
      components: [],
      isComplete: true,
      questionMessageId: 'question-1',
      createdAt: now,
    };
    const userMessage = {
      id: 'question-1',
      conversationType: 'user',
      content: 'Question',
      components: [],
      isComplete: true,
      createdAt: now,
    };
    const { service, messageStore } = createService({
      reportStore: { findById: jest.fn().mockResolvedValue(report()) },
      userService: {
        findSummaryById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
      },
      messageStore: {
        findReportMessageById: jest
          .fn()
          .mockResolvedValueOnce(aiMessage)
          .mockResolvedValueOnce(userMessage),
      },
    });

    await expect(service.findById('report-1')).resolves.toMatchObject({
      userMessage: { id: 'question-1', content: 'Question' },
      aiMessage: { id: 'message-1', isComplete: true },
      reporter: { id: 'user-1', email: 'user@example.com' },
    });
    expect(messageStore.findReportMessageById.mock.calls).toEqual([['message-1'], ['question-1']]);
  });
});
