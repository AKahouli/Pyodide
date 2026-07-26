import { ResponseReliabilityService } from './response-reliability.service';

describe('ResponseReliabilityService lifecycle', () => {
  it('heartbeats queued work before expiring abandoned pending evaluations', async () => {
    const messageService = {
      touchPendingReliabilityEvaluations: jest.fn().mockResolvedValue(undefined),
      markStaleReliabilityEvaluationsFailed: jest.fn().mockResolvedValue(1),
    };
    const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new ResponseReliabilityService(
      {} as never,
      messageService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
    );
    (service as unknown as { scheduledMessageIds: Set<string> }).scheduledMessageIds.add('message-1');

    await service.cleanupStalePending();

    expect(messageService.touchPendingReliabilityEvaluations).toHaveBeenCalledWith(['message-1']);
    expect(messageService.touchPendingReliabilityEvaluations.mock.invocationCallOrder[0])
      .toBeLessThan(messageService.markStaleReliabilityEvaluationsFailed.mock.invocationCallOrder[0]);
  });

  it('persists every evaluated claim while keeping prioritized findings limited', async () => {
    const claims = [
      { claim: 'Supported claim', status: 'supported', importance: 'major', explanation: 'Matched', evidenceIds: ['evidence-0'] },
      { claim: 'Partial claim', status: 'partially_supported', importance: 'minor', explanation: 'Partly matched', evidenceIds: ['evidence-0'] },
      { claim: 'Missing claim', status: 'unsupported', importance: 'critical', explanation: 'Not found', evidenceIds: [] },
    ];
    const findings = [claims[2]];
    const messageService = {
      getMessageDocument: jest.fn()
        .mockResolvedValueOnce({ _id: { toString: () => 'message-1' }, components: [] })
        .mockResolvedValueOnce({ content: 'Question' }),
      updateReliabilityEvaluation: jest.fn().mockResolvedValue(undefined),
    };
    const evidenceBuilder = {
      build: jest.fn().mockReturnValue({
        requestId: 'request-1',
        messageId: 'message-1',
        question: 'Question',
        segments: [{ componentId: 'text-1', text: 'Answer', evidence: [{ id: 'evidence-0', type: 'document', content: 'Evidence' }] }],
        globalEvidence: [],
      }),
    };
    const scoringService = {
      scoreClaims: jest.fn().mockReturnValue({
        score: 58,
        label: 'needs_verification',
        summary: 'Review needed',
        claimCounts: { total: 3, supported: 1, partiallySupported: 1, unsupported: 1, contradicted: 0 },
        findings,
      }),
    };
    const modelsService = {
      findById: jest.fn().mockResolvedValue({ id: 'model-1', isActive: true, types: ['chat'] }),
      getModelIdentifier: jest.fn().mockReturnValue('judge-model'),
    };
    const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new ResponseReliabilityService(
      {} as never,
      messageService as never,
      modelsService as never,
      {} as never,
      evidenceBuilder as never,
      scoringService as never,
      logger as never,
    );
    jest.spyOn(service as never, 'callEvaluator' as never).mockResolvedValue({
      applicability: 'evaluated',
      claims,
      evaluatorVersion: 'v1',
      promptVersion: 'p1',
    } as never);

    await (service as unknown as { processJob: (job: unknown) => Promise<void> }).processJob({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      questionMessageId: 'question-1',
      userId: 'user-1',
      requestId: 'request-1',
      requestedAt: '2026-07-26T10:00:00.000Z',
      settings: { enabled: true, mode: 'informative', judgeModelId: 'model-1', maxConcurrentEvaluations: 1, timeoutMs: 30000, maxFindings: 1 },
    });

    expect(scoringService.scoreClaims).toHaveBeenCalledWith(claims, 1);
    expect(messageService.updateReliabilityEvaluation).toHaveBeenCalledWith('message-1', expect.objectContaining({
      status: 'completed',
      claims,
      findings,
    }));
  });
});
