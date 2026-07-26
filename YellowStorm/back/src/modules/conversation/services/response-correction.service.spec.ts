import axios from 'axios';
import { DEFAULT_ADMIN_EVALUATION_SETTINGS } from '@modules/evaluation/services/evaluation-settings.service';
import { ResponseCorrectionService } from './response-correction.service';
import { ResponseCorrectionPlannerService } from './response-correction-planner.service';
import { CorrectedResponseComponentBuilder } from './corrected-response-component.builder';
import { ResponseCorrectionPolicyService } from './response-correction-policy.service';

describe('ResponseCorrectionService', () => {
  const originalComponents = [
    { id: 'text-1', type: 'text' as const, data: { content: 'Revenue was 20.' } },
    { id: 'citation-1', type: 'citation' as const, data: { reference: '1' } },
  ];
  const originalEvaluation = {
    status: 'completed' as const,
    score: 30,
    claims: [{ claim: 'Revenue was 20.', status: 'contradicted' as const, importance: 'critical' as const, explanation: 'Conflict', evidenceIds: ['evidence-0'] }],
  };
  const settings = {
    ...DEFAULT_ADMIN_EVALUATION_SETTINGS.responseReliability,
    enabled: true,
    mode: 'corrective_transparent' as const,
    judgeModelId: 'model-1',
  };

  function createService() {
    const messageService = {
      getMessageDocument: jest.fn()
        .mockResolvedValueOnce({ _id: { toString: () => 'message-1' }, components: originalComponents })
        .mockResolvedValueOnce({ content: 'What is revenue?' }),
      updateCorrectionWorkflow: jest.fn().mockResolvedValue(undefined),
    };
    const reportService = { createSystemCorrectionReport: jest.fn().mockResolvedValue({ id: 'report-1' }) };
    const scoringService = {
      scoreClaims: jest.fn().mockReturnValue({
        score: 90, label: 'strongly_supported', summary: 'Supported',
        claimCounts: { total: 1, supported: 1, partiallySupported: 0, unsupported: 0, contradicted: 0 }, findings: [],
      }),
    };
    const service = new ResponseCorrectionService(
      messageService as never,
      { findById: jest.fn().mockResolvedValue({ id: 'model-1', isActive: true, omitTemperature: true }), getModelIdentifier: jest.fn().mockReturnValue('judge-model') } as never,
      { get: jest.fn((key: string) => key === 'indexing.apiAdk' ? 'http://adk' : 'api-key') } as never,
      { build: jest.fn().mockReturnValue({
        requestId: 'request-1', messageId: 'message-1', question: 'What is revenue?',
        segments: [{ componentId: 'text-1', text: 'Revenue was 20.', evidence: [{ id: 'evidence-0', type: 'document', content: 'Revenue was 10.' }] }], globalEvidence: [],
      }) } as never,
      scoringService as never,
      new ResponseCorrectionPlannerService(),
      new CorrectedResponseComponentBuilder(),
      new ResponseCorrectionPolicyService(),
      reportService as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );
    return { service, messageService, reportService };
  }

  const job = {
    messageId: 'message-1', conversationId: 'conversation-1', questionMessageId: 'question-1', userId: 'user-1', requestId: 'request-1',
    originalEvaluation, settings, queuedAt: '2026-07-26T00:00:00.000Z',
  };

  afterEach(() => jest.restoreAllMocks());

  it('publishes the first successful candidate while preserving original components', async () => {
    jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: {
        correctedSegments: [{ text: 'Revenue was 10.', evidenceIds: ['evidence-0'] }],
        appliedCorrections: [{ claim: 'Revenue was 20.', action: 'replaced', explanation: 'Aligned', evidenceIds: ['evidence-0'] }],
        remainingUncertainties: [], correctorVersion: 'v1', promptVersion: 'p1',
      } })
      .mockResolvedValueOnce({ data: {
        applicability: 'evaluated', claims: [{ claim: 'Revenue was 10.', status: 'supported', importance: 'critical', explanation: 'Matched', evidenceIds: ['evidence-0'] }],
        evaluatorVersion: 'v1', promptVersion: 'p1',
      } });
    const { service, messageService } = createService();

    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(job);

    expect(axios.post).toHaveBeenNthCalledWith(1, 'http://adk/response-evaluation/correct', expect.objectContaining({
      originalSegments: [{ componentId: 'text-1', text: 'Revenue was 20.' }],
    }), expect.any(Object));
    expect(messageService.updateCorrectionWorkflow).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'corrected', activeVersion: 'corrected', attemptCount: 1,
      correctedComponents: expect.arrayContaining([expect.objectContaining({ data: { content: 'Revenue was 10.' } })]),
      finalReliabilityEvaluation: expect.objectContaining({ score: 90 }),
    }));
    expect(originalComponents[0].data.content).toBe('Revenue was 20.');
  });

  it('deduplicates scheduling and applies overflow behavior', async () => {
    const { service, messageService } = createService();
    jest.spyOn(service as any, 'drain').mockImplementation(() => undefined);
    await service.schedule({ ...job });
    await service.schedule({ ...job });
    expect((service as unknown as { queue: unknown[] }).queue).toHaveLength(1);
    expect(messageService.updateCorrectionWorkflow).toHaveBeenCalledTimes(1);
  });

  it('creates one system report for human-review failure behavior', async () => {
    const { service, reportService, messageService } = createService();
    const humanReviewJob = { ...job, settings: { ...settings, correction: { ...settings.correction, failureBehavior: 'require_human_review' as const } } };
    await (service as unknown as { applyFailure: (input: unknown, code: string, duration: number) => Promise<void> }).applyFailure(humanReviewJob, 'correction_attempts_exhausted', 100);
    expect(reportService.createSystemCorrectionReport).toHaveBeenCalledTimes(1);
    expect(messageService.updateCorrectionWorkflow).toHaveBeenCalledWith('message-1', expect.objectContaining({ status: 'human_review_required', reviewReportId: 'report-1' }));
  });

  it.each([
    ['publish_with_warning', 'failed', 'original'],
    ['abstain', 'abstained', 'abstention'],
  ] as const)('applies %s failure behavior', async (failureBehavior, status, activeVersion) => {
    const { service, messageService } = createService();
    const failureJob = { ...job, settings: { ...settings, correction: { ...settings.correction, failureBehavior } } };
    await (service as unknown as { applyFailure: (input: unknown, code: string, duration: number) => Promise<void> }).applyFailure(failureJob, 'correction_failed', 100);
    expect(messageService.updateCorrectionWorkflow).toHaveBeenCalledWith('message-1', expect.objectContaining({ status, activeVersion, failureCode: 'correction_failed' }));
  });

  it('classifies an invalid ADK correction response', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: { status: 502, data: { detail: 'The response corrector returned an invalid response' } },
    });
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const { service, messageService } = createService();
    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(job);
    expect(messageService.updateCorrectionWorkflow).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'failed', failureCode: 'corrector_invalid_response',
    }));
  });
});
