import axios from 'axios';
import { DEFAULT_ADMIN_EVALUATION_SETTINGS } from '@modules/evaluation/services/evaluation-settings.service';
import { ResponseCorrectionService } from './response-correction.service';
import { ResponseCorrectionPlannerService } from './response-correction-planner.service';
import { CorrectedResponseComponentBuilder } from './corrected-response-component.builder';
import { ResponseCorrectionPolicyService } from './response-correction-policy.service';
import { CorrectiveReplayFailure } from './corrective-replay-runner.service';

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

  function createService(useReplay = false, replayFailure?: CorrectiveReplayFailure) {
    const messageService = {
      getMessageDocument: jest.fn()
        .mockResolvedValueOnce({ _id: { toString: () => 'message-1' }, components: originalComponents })
        .mockResolvedValueOnce({ content: 'What is revenue?' }),
      updateCorrectionWorkflow: jest.fn().mockResolvedValue(undefined),
      upsertCorrectionAttempt: jest.fn().mockResolvedValue(undefined),
      claimCorrectionRun: jest.fn().mockResolvedValue(true),
    };
    const reportService = { createSystemCorrectionReport: jest.fn().mockResolvedValue({ id: 'report-1' }) };
    const scoringService = {
      scoreClaims: jest.fn().mockReturnValue({
        score: 90, label: 'strongly_supported', summary: 'Supported',
        claimCounts: { total: 1, supported: 1, partiallySupported: 0, unsupported: 0, contradicted: 0 }, findings: [],
      }),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const service = new ResponseCorrectionService(
      messageService as never,
      { findById: jest.fn().mockResolvedValue({ id: 'model-1', isActive: true, omitTemperature: true }), getModelIdentifier: jest.fn().mockReturnValue('judge-model') } as never,
      { get: jest.fn((key: string) => key === 'indexing.apiAdk' ? 'http://adk' : 'api-key') } as never,
      { build: jest.fn().mockReturnValue({
        requestId: 'request-1', messageId: 'message-1', question: 'What is revenue?',
        segments: [{ componentId: 'text-1', text: 'Revenue was 20.', evidence: [{ id: 'evidence-0', type: 'document', content: 'Revenue was 10.' }] }], globalEvidence: [],
      }), buildFromComponents: jest.fn().mockReturnValue({
        requestId: 'request-1:replay:1', messageId: 'message-1', question: 'What is revenue?',
        segments: [{ componentId: 'replay-text', text: 'Revenue was 10.', evidence: [{ id: 'evidence-0', type: 'document', content: 'Revenue was 10.' }] }], globalEvidence: [],
      }) } as never,
      scoringService as never,
      new ResponseCorrectionPlannerService(),
      new CorrectedResponseComponentBuilder(),
      new ResponseCorrectionPolicyService(),
      reportService as never,
      { resolve: jest.fn().mockResolvedValue(useReplay ? { historical: false, request: {
        content: 'What is revenue?', attachedFileIds: [], webSearchEnabled: false,
        deepSearchEnabled: false, agentIds: [], skillIds: [],
      } } : undefined) } as never,
      { run: replayFailure ? jest.fn().mockRejectedValue(replayFailure) : jest.fn().mockResolvedValue({
          components: [{ id: 'replay-text', type: 'text', data: { content: 'Revenue was 10.' } }],
          evidenceComponents: [
            { id: 'replay-text', type: 'text', data: { content: 'Revenue was 10.' } },
            { id: 'tool-search', type: 'toolActivity', data: { title: 'perform_document_search', status: 'completed', resultJson: '{"sources_text":[{"page_content":"Revenue was 10."}]}' } },
          ],
          usage: { inputTokens: 10, outputTokens: 5, durationMs: 100 }, promptVersion: 'corrective-replay-v2',
        }) } as never,
      logger as never,
    );
    return { service, messageService, reportService, logger };
  }

  const job = {
    messageId: 'message-1', conversationId: 'conversation-1', questionMessageId: 'question-1', userId: 'user-1', requestId: 'request-1',
    originalEvaluation, settings, queuedAt: '2026-07-26T00:00:00.000Z',
  };

  afterEach(() => jest.restoreAllMocks());

  it('evaluates private replay evidence while publishing only public components', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: {
      applicability: 'evaluated', claims: [{ claim: 'Revenue was 10.', status: 'supported', importance: 'critical', explanation: 'Matched', evidenceIds: ['evidence-0'] }],
      evaluatorVersion: 'v1', promptVersion: 'p1',
    } });
    const { service, messageService } = createService(true);

    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(job);

    const evidenceBuilder = (service as any).evidenceBuilder;
    expect(evidenceBuilder.buildFromComponents).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.arrayContaining([expect.objectContaining({ id: 'tool-search', type: 'toolActivity' })]),
    }));
    expect(messageService.updateCorrectionWorkflow).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      correctedComponents: [{ id: 'replay-text', type: 'text', data: { content: 'Revenue was 10.' } }],
    }));
  });

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

  it('retains a generated replay and its rejection reasons when publication policy fails', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: {
      applicability: 'evaluated',
      claims: [{ claim: 'Revenue was 10.', status: 'unsupported', importance: 'critical', explanation: 'Still unsupported', evidenceIds: ['evidence-0'] }],
      evaluatorVersion: 'v1', promptVersion: 'p1',
    } });
    const { service, messageService } = createService(true);
    (service as any).scoringService.scoreClaims.mockReturnValue({
      score: 52, label: 'needs_verification', summary: 'Unsupported',
      claimCounts: { total: 1, supported: 0, partiallySupported: 0, unsupported: 1, contradicted: 0 },
      findings: [{ claim: 'Revenue was 10.', status: 'unsupported', importance: 'critical', explanation: 'Still unsupported' }],
    });

    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(job);

    expect(messageService.upsertCorrectionAttempt).toHaveBeenCalledWith('message-1', expect.objectContaining({
      attemptId: 'attempt-1', status: 'generated',
      components: [{ id: 'replay-text', type: 'text', data: { content: 'Revenue was 10.' } }],
    }));
    expect(messageService.upsertCorrectionAttempt).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'rejected', decision: 'rejected',
      policyReasons: ['score_below_threshold', 'critical_claim_unresolved'],
      evaluation: expect.objectContaining({ score: 52, evaluatedAt: expect.any(String) }),
    }));
    expect(messageService.updateCorrectionWorkflow).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'failed', activeVersion: 'original', failureCode: 'correction_attempts_exhausted',
    }));
  });

  it('persists not_applicable as a valid evaluation outcome instead of a technical failure', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: {
      applicability: 'not_applicable', claims: [], evaluatorVersion: 'v1', promptVersion: 'p1',
    } });
    const { service, messageService, logger } = createService(true);

    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(job);

    expect(messageService.upsertCorrectionAttempt).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'rejected',
      policyReasons: ['evaluation_not_applicable'],
      evaluation: expect.objectContaining({ status: 'not_applicable', evaluatedAt: expect.any(String) }),
    }));
    expect(logger.log).toHaveBeenCalledWith('Correction candidate evaluation completed', expect.objectContaining({
      attemptNumber: 1, status: 'not_applicable',
    }));
  });

  it('records and logs evaluator failures with evaluator-specific diagnostics', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: { status: 502, data: { detail: 'The reliability evaluator is unavailable' } },
    });
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const { service, messageService, logger } = createService(true);

    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(job);

    expect(messageService.upsertCorrectionAttempt).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'failed',
      policyReasons: ['candidate_evaluation_failed'],
      failureCode: 'candidate_evaluation_unavailable',
      evaluation: expect.objectContaining({ status: 'failed', failureCode: 'candidate_evaluation_unavailable' }),
    }));
    expect(logger.warn).toHaveBeenCalledWith('Correction candidate evaluation failed', expect.objectContaining({
      attemptNumber: 1, failureCode: 'candidate_evaluation_unavailable', durationMs: expect.any(Number),
    }));
  });

  it('records a generated candidate as an evaluation timeout when the correction deadline is exhausted', async () => {
    const times = [1_000, 1_000, 1_000, 1_000, 2_001];
    jest.spyOn(Date, 'now').mockImplementation(() => times.shift() ?? 2_001);
    const { service, messageService, logger } = createService(true);
    const expiredJob = {
      ...job,
      settings: { ...settings, correction: { ...settings.correction, maxDurationMs: 1_000 } },
    };

    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(expiredJob);

    expect(messageService.upsertCorrectionAttempt).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'failed',
      components: expect.arrayContaining([expect.objectContaining({ id: 'replay-text' })]),
      policyReasons: ['candidate_evaluation_failed'],
      failureCode: 'candidate_evaluation_timeout',
      evaluation: expect.objectContaining({ status: 'failed', failureCode: 'candidate_evaluation_timeout' }),
    }));
    expect(logger.warn).toHaveBeenCalledWith('Correction candidate evaluation failed', expect.objectContaining({
      failureCode: 'candidate_evaluation_timeout',
    }));
  });

  it('deduplicates scheduling and applies overflow behavior', async () => {
    const { service, messageService } = createService();
    jest.spyOn(service as any, 'drain').mockImplementation(() => undefined);
    await service.schedule({ ...job });
    await service.schedule({ ...job });
    expect((service as unknown as { queue: unknown[] }).queue).toHaveLength(1);
    expect(messageService.updateCorrectionWorkflow).toHaveBeenCalledTimes(1);
  });

  it('uses replay by default and evaluates replay-owned evidence', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: {
      applicability: 'evaluated', claims: [{ claim: 'Revenue was 10.', status: 'supported', importance: 'critical', explanation: 'Matched', evidenceIds: ['evidence-0'] }],
      evaluatorVersion: 'v1', promptVersion: 'p1',
    } });
    const { service, messageService } = createService(true);

    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(job);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith('http://adk/response-evaluation/evaluate', expect.objectContaining({
      requestId: 'request-1:replay:1',
    }), expect.any(Object));
    expect((service as any).replayRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: settings.correction.maxDurationMs - Math.min(60_000, Math.floor(settings.correction.maxDurationMs / 4)),
    }));
    expect(messageService.updateCorrectionWorkflow).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'corrected', strategy: 'corrective_replay',
    }));
  });

  it('uses existing evidence when the replay transport cannot start', async () => {
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
    const { service, messageService } = createService(
      true,
      new CorrectiveReplayFailure('corrective_replay_grpc_unavailable', false),
    );

    await (service as unknown as { process: (input: unknown) => Promise<void> }).process(job);

    expect(axios.post).toHaveBeenNthCalledWith(1, 'http://adk/response-evaluation/correct', expect.any(Object), expect.any(Object));
    expect(messageService.updateCorrectionWorkflow).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'corrected', strategy: 'existing_evidence',
    }));
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
    expect(messageService.upsertCorrectionAttempt).toHaveBeenLastCalledWith('message-1', expect.objectContaining({
      status: 'failed', policyReasons: ['candidate_generation_failed'], evaluation: undefined,
    }));
  });
});
