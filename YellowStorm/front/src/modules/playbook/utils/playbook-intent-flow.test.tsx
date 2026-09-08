import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mergeConstructionDiagnostics, usePlaybookIntentFlow } from './playbook-intent-flow';
import type { AdvisorRemediationPreviewResponse, Playbook, PlaybookIntentSuggestion } from '../types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function buildDeps(preview: AdvisorRemediationPreviewResponse) {
  const playbook = {
    id: 'p1',
    name: 'Advisor test playbook',
    definitionRevision: 7,
    tasks: [{ id: 't1', title: 'Analyze Data' }],
  } as Playbook;

  const startAdvisorRemediationConstruction = vi.fn().mockResolvedValue({ constructionId: 'advisor-operation', playbookId: 'p1', baseDefinitionRevision: 7, target: 'advisor_preview' });
  const streamPlaybookIntentConstruction = vi.fn(async (_playbookId, _constructionId, options) => {
    options.onEvent({ type: 'node_delta', constructionId: 'advisor-operation', playbookId: 'p1', sequence: 1, suggestion: preview.suggestion } as any);
    options.onEvent({ type: 'completed', constructionId: 'advisor-operation', playbookId: 'p1', sequence: 2 } as any);
  });
  return {
    id: 'p1',
    playbook,
    selectedStepId: 't1',
    isDirty: false,
    intentValue: '',
    intentDesign: null,
    selectStep: vi.fn(),
    assessPlaybookIntentDesign: vi.fn(),
    requestPlaybookIntent: vi.fn(),
    saveNow: vi.fn(),
    handleApplyIntentSuggestion: vi.fn(),
    setIntentLoading: vi.fn(),
    setIntentError: vi.fn(),
    setIntentDesign: vi.fn(),
    setIntentSuggestions: vi.fn(),
    setLastIntentSuggestions: vi.fn(),
    addIntentSuggestionHistoryEntry: vi.fn(),
    previewAdvisorRemediation: vi.fn().mockResolvedValue(preview),
    startAdvisorRemediationConstruction,
    startPlaybookIntentConstruction: vi.fn(),
    streamPlaybookIntentConstruction,
    constructionAbortRef: { current: null },
    captureConstructionSnapshot: vi.fn(),
    setPreviewConstructionReady: vi.fn(),
    setCanonicalConstructionReady: vi.fn(),
    setCanonicalConstructionPending: vi.fn(),
    clearCanonicalConstructionPending: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
    getCurrentDefinitionRevision: vi.fn(() => 7),
    realtimeConstructionEnabled: true,
  };
}

const validStepSuggestion: PlaybookIntentSuggestion = {
  id: 's1',
  kind: 'single_change',
  label: 'Optimize step',
  summary: 'Clarify the selected task.',
  reason: 'The task contract is vague.',
  confidence: 0.9,
  operationType: 'update_node',
  task: { description: 'Produce a grounded summary.' },
  targetTaskId: 't1',
  isDirectIntentFallback: false,
};

const blockedWorkflowSuggestion: PlaybookIntentSuggestion = {
  id: 'blocked-plan',
  kind: 'workflow_plan',
  label: 'Blocked plan',
  summary: 'Validation warnings are non-blocking.',
  reason: 'A required input is unbound.',
  confidence: 0.9,
  impact: { nodesToCreate: 1, nodesToUpdate: 0, nodesToDelete: 0, edgesToCreate: 0, edgesToDelete: 0, dataBindingsToCreate: 0, dataBindingsToDelete: 0, affectedTaskIds: [], businessOutcome: '' },
  changes: [],
  validationStatus: 'blocked',
  isDirectIntentFallback: false,
};

const additiveWorkflowSuggestion: PlaybookIntentSuggestion = {
  id: 'additive-plan',
  kind: 'workflow_plan',
  label: 'Append a task',
  summary: 'Append a task after the current last task.',
  reason: 'The existing workflow needs one more task.',
  confidence: 0.9,
  impact: { nodesToCreate: 1, nodesToUpdate: 0, nodesToDelete: 0, edgesToCreate: 0, edgesToDelete: 0, dataBindingsToCreate: 0, dataBindingsToDelete: 0, affectedTaskIds: ['t1'], businessOutcome: '' },
  changes: [{
    type: 'create_node',
    nodeRef: 'appended-task',
    anchor: { mode: 'after', targetTaskId: 't1', nodeRef: null, targetTaskIds: ['t1'] },
    task: { title: 'Appended task', description: 'Continue the existing workflow.' },
  }],
  isDirectIntentFallback: false,
};

describe('mergeConstructionDiagnostics', () => {
  it('deduplicates cumulative diagnostics while preserving actionable targets', () => {
    const diagnostic = {
      severity: 'warning' as const,
      stage: 'repair' as const,
      code: 'repair_template_required_port_added',
      itemId: 'prepare_report',
      message: 'repair_template_required_port_added',
      reviewTarget: { kind: 'node' as const, nodeRef: 'prepare_report', nodeLabel: 'Prepare report' },
      resolutionCode: 'review_port' as const,
    };
    const suggestion = {
      ...additiveWorkflowSuggestion,
      diagnostics: [diagnostic],
    };

    expect(mergeConstructionDiagnostics([diagnostic], suggestion)).toEqual([diagnostic]);
  });
});

describe('usePlaybookIntentFlow advisor remediation', () => {
  it('uses design assessment before manual-mode generation', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      intentValue: 'Build invoice workflow',
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({
        status: 'needs_clarification',
        detectedIntent: 'Build invoice workflow',
        questions: [{ id: 'q1', question: 'Which datasource?', reason: '', category: 'datasource', required: true, choices: ['SharePoint'] }],
        missingRequirements: ['Datasource'],
        riskFlags: [],
      }),
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleSubmitIntent();
    });

    expect(deps.assessPlaybookIntentDesign).toHaveBeenCalledWith('p1', { intent: 'Build invoice workflow', selectedTaskId: 't1' });
    expect(deps.setIntentDesign).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_clarification' }));
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
  });

  it('routes ready Designer submissions through realtime construction when enabled', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Build workflow' }),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({ constructionId: 'construction-ready', playbookId: 'p1', baseDefinitionRevision: 7 }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'node_delta', constructionId: 'construction-ready', playbookId: 'p1', sequence: 1, suggestion: validStepSuggestion } as any);
        options.onEvent({ type: 'completed', constructionId: 'construction-ready', playbookId: 'p1', sequence: 2 } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleSubmitIntentText('Build workflow');
    });

    expect(deps.startPlaybookIntentConstruction).toHaveBeenCalledWith('p1', { intent: 'Build workflow', selectedTaskId: 't1' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(deps.captureConstructionSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(validStepSuggestion, expect.objectContaining({
      save: false,
      captureHistory: false,
      applicationKey: 'intent-construction-construction-ready',
    }));
    expect(deps.setCanonicalConstructionPending).toHaveBeenCalledWith('construction-ready', 7);
    expect(deps.finalizeConstruction).toHaveBeenCalledWith(7, 'construction-ready');
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
  });

  it('applies streamed workflow plans as explicit deltas without replacing the existing graph', async () => {
    const deps = {
      ...buildDeps({
        suggestion: additiveWorkflowSuggestion,
        suggestions: [additiveWorkflowSuggestion],
        intent: 'Append a task.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Append a task' }),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({ constructionId: 'construction-additive', playbookId: 'p1', baseDefinitionRevision: 7 }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'node_delta', constructionId: 'construction-additive', playbookId: 'p1', sequence: 1, suggestion: additiveWorkflowSuggestion } as any);
        options.onEvent({ type: 'completed', constructionId: 'construction-additive', playbookId: 'p1', sequence: 2 } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleSubmitIntentText('Append a task');
    });

    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(additiveWorkflowSuggestion, expect.objectContaining({
      replaceAll: false,
      save: false,
      captureHistory: false,
    }));
    expect(deps.finalizeConstruction).toHaveBeenCalledWith(7, 'construction-additive');
  });

  it('consumes an MCP-started construction without starting a second operation', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      startPlaybookIntentConstruction: vi.fn(),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'started', constructionId: 'mcp-operation', playbookId: 'p1', sequence: 1, baseDefinitionRevision: 6, model: 'model-1' } as any);
        options.onEvent({ type: 'node_delta', constructionId: 'mcp-operation', playbookId: 'p1', sequence: 2, suggestion: validStepSuggestion } as any);
        options.onEvent({ type: 'completed', constructionId: 'mcp-operation', playbookId: 'p1', sequence: 3 } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      rollbackConstruction: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.consumePlaybookConstruction({ constructionId: 'mcp-operation', playbookId: 'p1', baseDefinitionRevision: 7 });
    });

    expect(deps.startPlaybookIntentConstruction).not.toHaveBeenCalled();
    expect(deps.streamPlaybookIntentConstruction).toHaveBeenCalledWith('p1', 'mcp-operation', expect.any(Object));
    expect(deps.captureConstructionSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.finalizeConstruction).toHaveBeenCalledWith(6, 'mcp-operation');
  });

  it('fails closed without legacy preview when realtime construction is disabled', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      realtimeConstructionEnabled: false,
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Build workflow' }),
      requestPlaybookIntent: vi.fn().mockResolvedValue({ suggestions: [validStepSuggestion] }),
      startPlaybookIntentConstruction: vi.fn(),
      streamPlaybookIntentConstruction: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleSubmitIntentText('Build workflow');
    });

    expect(deps.startPlaybookIntentConstruction).not.toHaveBeenCalled();
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
    expect(deps.setIntentError).toHaveBeenCalled();
  });

  it('fails closed without legacy preview when construction fails before a delta', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Build workflow' }),
      requestPlaybookIntent: vi.fn().mockResolvedValue({ suggestions: [validStepSuggestion] }),
      startPlaybookIntentConstruction: vi.fn().mockRejectedValue(new Error('Construction unavailable')),
      streamPlaybookIntentConstruction: vi.fn(),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleSubmitIntentText('Build workflow');
    });

    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
    expect(deps.setIntentError).toHaveBeenCalledWith('Construction unavailable');
  });

  it('does not mutate or roll back the graph when construction emits a delta and then fails', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Build workflow' }),
      requestPlaybookIntent: vi.fn(),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({ constructionId: 'construction-partial', playbookId: 'p1', baseDefinitionRevision: 7 }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'node_delta', constructionId: 'construction-partial', playbookId: 'p1', sequence: 1, suggestion: validStepSuggestion } as any);
        throw new Error('Stream interrupted');
      }),
      captureConstructionSnapshot: vi.fn(),
      rollbackConstruction: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    let response: Awaited<ReturnType<typeof result.current.handleSubmitIntentText>> | undefined;
    await act(async () => {
      response = await result.current.handleSubmitIntentText('Build workflow');
    });

    expect(response?.status).toBe('failed');
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
    expect(deps.captureConstructionSnapshot).not.toHaveBeenCalled();
    expect(deps.handleApplyIntentSuggestion).not.toHaveBeenCalled();
    expect(deps.finalizeConstruction).not.toHaveBeenCalled();
    expect(deps.rollbackConstruction).not.toHaveBeenCalled();
  });

  it('retains a complete blocked workflow locally after strict validation fails', async () => {
    const diagnostic = {
      severity: 'error' as const,
      stage: 'invariant_validator' as const,
      code: 'validator_rule_5',
      message: 'Router cycle has no terminal exit route',
      reviewTarget: { kind: 'node' as const, nodeRef: 'challenge_router', nodeLabel: 'Challenge router' },
      resolutionCode: 'review_router' as const,
    };
    const blockedSuggestion = { ...blockedWorkflowSuggestion, diagnostics: [diagnostic] };
    const deps = {
      ...buildDeps({
        suggestion: blockedSuggestion,
        suggestions: [blockedSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: false, warnings: [], errors: [diagnostic.message] },
      }),
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Build workflow' }),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({ constructionId: 'construction-blocked', playbookId: 'p1', baseDefinitionRevision: 7 }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'node_delta', constructionId: 'construction-blocked', playbookId: 'p1', sequence: 1, suggestion: blockedSuggestion } as any);
        options.onEvent({
          type: 'failed', constructionId: 'construction-blocked', playbookId: 'p1', sequence: 2,
          message: diagnostic.message, recoverable: true, failureKind: 'strict_validation',
        } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      rollbackConstruction: vi.fn(),
      finalizeConstruction: vi.fn(),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionDiagnostics: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    let response: Awaited<ReturnType<typeof result.current.handleSubmitIntentText>> | undefined;
    await act(async () => {
      response = await result.current.handleSubmitIntentText('Build workflow');
    });

    expect(response).toEqual({ status: 'failed', error: diagnostic.message });
    expect(deps.captureConstructionSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(blockedSuggestion, expect.objectContaining({ save: false }));
    expect(deps.setCanonicalConstructionReady).toHaveBeenCalledWith('construction-blocked', 7);
    expect(deps.clearCanonicalConstructionPending).not.toHaveBeenCalled();
    expect(deps.finalizeConstruction).not.toHaveBeenCalled();
    expect(deps.rollbackConstruction).not.toHaveBeenCalled();
    expect(deps.setConstructionDiagnostics).toHaveBeenCalledWith([diagnostic]);
  });

  it('does not fall back after direct construction applies but final persistence fails', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Build workflow' }),
      requestPlaybookIntent: vi.fn(),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({ constructionId: 'construction-save-failure', playbookId: 'p1', baseDefinitionRevision: 7 }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'node_delta', constructionId: 'construction-save-failure', playbookId: 'p1', sequence: 1, suggestion: validStepSuggestion } as any);
        options.onEvent({ type: 'completed', constructionId: 'construction-save-failure', playbookId: 'p1', sequence: 2 } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      rollbackConstruction: vi.fn(),
      finalizeConstruction: vi.fn().mockRejectedValue(new Error('Save failed')),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    let response: Awaited<ReturnType<typeof result.current.handleSubmitIntentText>> | undefined;
    await act(async () => {
      response = await result.current.handleSubmitIntentText('Build workflow');
    });

    expect(response).toEqual({ status: 'failed', error: 'Save failed' });
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledTimes(1);
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
    expect(deps.setCanonicalConstructionReady).toHaveBeenCalledWith('construction-save-failure', 7);
    expect(deps.clearCanonicalConstructionPending).not.toHaveBeenCalled();
    expect(deps.rollbackConstruction).not.toHaveBeenCalled();
  });

  it('returns skipped without legacy fallback when construction is cancelled', async () => {
    const constructionAbortRef = { current: null as AbortController | null };
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Build workflow' }),
      requestPlaybookIntent: vi.fn(),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({ constructionId: 'construction-cancelled', playbookId: 'p1', baseDefinitionRevision: 7 }),
      streamPlaybookIntentConstruction: vi.fn(async () => {
        constructionAbortRef.current?.abort();
      }),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      constructionAbortRef,
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    let response: Awaited<ReturnType<typeof result.current.handleSubmitIntentText>> | undefined;
    await act(async () => {
      response = await result.current.handleSubmitIntentText('Build workflow');
    });

    expect(response?.status).toBe('skipped');
    expect(deps.setConstructionStatus).toHaveBeenCalledWith('cancelled');
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
  });

  it('returns skipped without saving or fallback on a server cancellation event', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      assessPlaybookIntentDesign: vi.fn().mockResolvedValue({ status: 'ready_to_generate', detectedIntent: 'Build workflow' }),
      requestPlaybookIntent: vi.fn(),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({ constructionId: 'construction-server-cancelled', playbookId: 'p1', baseDefinitionRevision: 7 }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'node_delta', constructionId: 'construction-server-cancelled', playbookId: 'p1', sequence: 1, suggestion: validStepSuggestion } as any);
        options.onEvent({ type: 'cancelled', constructionId: 'construction-server-cancelled', playbookId: 'p1', sequence: 2, reason: 'Stopped' } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      rollbackConstruction: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    let response: Awaited<ReturnType<typeof result.current.handleSubmitIntentText>> | undefined;
    await act(async () => {
      response = await result.current.handleSubmitIntentText('Build workflow');
    });

    expect(response?.status).toBe('skipped');
    expect(deps.captureConstructionSnapshot).not.toHaveBeenCalled();
    expect(deps.handleApplyIntentSuggestion).not.toHaveBeenCalled();
    expect(deps.rollbackConstruction).not.toHaveBeenCalled();
    expect(deps.finalizeConstruction).not.toHaveBeenCalled();
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
  });

  it('forces manual generation with typed clarification answers', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      intentValue: 'Build invoice workflow',
      requestPlaybookIntent: vi.fn().mockResolvedValue({ suggestions: [validStepSuggestion] }),
      getCurrentDefinitionRevision: vi.fn(() => 9),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({
        constructionId: 'construction-clarified',
        playbookId: 'p1',
        baseDefinitionRevision: 7,
      }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({
          type: 'node_delta',
          constructionId: 'construction-clarified',
          playbookId: 'p1',
          sequence: 1,
          suggestion: validStepSuggestion,
        } as any);
        options.onEvent({ type: 'completed', constructionId: 'construction-clarified', playbookId: 'p1', sequence: 2 } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleForceGenerateIntent('Use SharePoint invoices.');
    });

    expect(deps.assessPlaybookIntentDesign).not.toHaveBeenCalled();
    expect(deps.startPlaybookIntentConstruction).toHaveBeenCalledWith('p1', {
      intent: 'Build invoice workflow\n\nClarifications:\nUse SharePoint invoices.',
      selectedTaskId: 't1',
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
    expect(deps.captureConstructionSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(validStepSuggestion, expect.objectContaining({ captureHistory: false }));
    expect(deps.finalizeConstruction).toHaveBeenCalledWith(7, 'construction-clarified');
    expect(deps.setIntentSuggestions).not.toHaveBeenCalledWith([]);
  });

  it('passes image attachments to realtime construction', async () => {
    const images = [{ mediaType: 'image/png' as const, data: 'aW1hZ2U=', name: 'diagram.png' }];
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({
        constructionId: 'construction-images',
        playbookId: 'p1',
        baseDefinitionRevision: 7,
      }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'completed', constructionId: 'construction-images', playbookId: 'p1', sequence: 1 } as any);
      }),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleForceGenerateIntentText('Build from this diagram', undefined, images);
    });

    expect(deps.startPlaybookIntentConstruction).toHaveBeenCalledWith('p1', {
      intent: 'Build from this diagram',
      selectedTaskId: 't1',
      images,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('force generation does not present a legacy preview fallback', async () => {
    const fallbackSuggestion: PlaybookIntentSuggestion = {
      ...validStepSuggestion,
      id: 'fallback',
      confidence: 1,
      isDirectIntentFallback: true,
    };
    const deps = {
      ...buildDeps({
        suggestion: fallbackSuggestion,
        suggestions: [fallbackSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      intentValue: 'Build invoice workflow',
      requestPlaybookIntent: vi.fn().mockResolvedValue({ suggestions: [fallbackSuggestion] }),
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleForceGenerateIntent('Use what is already known.');
    });

    expect(deps.handleApplyIntentSuggestion).not.toHaveBeenCalled();
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
    expect(deps.setIntentSuggestions).not.toHaveBeenCalledWith([fallbackSuggestion]);
  });

  it('does not present legacy workflow suggestions with validation warnings', async () => {
    const deps = {
      ...buildDeps({
        suggestion: blockedWorkflowSuggestion,
        suggestions: [blockedWorkflowSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: false, warnings: [], errors: ['Required input remains unbound.'] },
      }),
      intentValue: 'Build invoice workflow',
      requestPlaybookIntent: vi.fn().mockResolvedValue({ suggestions: [blockedWorkflowSuggestion] }),
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleForceGenerateIntent('Use what is already known.');
    });

    expect(deps.handleApplyIntentSuggestion).not.toHaveBeenCalled();
    expect(deps.addIntentSuggestionHistoryEntry).not.toHaveBeenCalled();
    expect(deps.requestPlaybookIntent).not.toHaveBeenCalled();
    expect(deps.setIntentSuggestions).not.toHaveBeenCalledWith([blockedWorkflowSuggestion]);
  });

  it('uses the latest revision for the final realtime construction save', async () => {
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      selectedStepId: null,
      intentValue: 'Build invoice reconciliation workflow',
      getCurrentDefinitionRevision: vi.fn(() => 9),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({
        constructionId: 'construction-1',
        playbookId: 'p1',
        baseDefinitionRevision: 7,
      }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({
          type: 'node_delta',
          constructionId: 'construction-1',
          playbookId: 'p1',
          sequence: 1,
          suggestion: validStepSuggestion,
        } as any);
        options.onEvent({ type: 'completed', constructionId: 'construction-1', playbookId: 'p1', sequence: 2 } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleForceGenerateIntent();
    });

    expect(deps.captureConstructionSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledTimes(1);
    expect(deps.finalizeConstruction).toHaveBeenCalledWith(7, 'construction-1');
  });

  it('applies the final realtime construction once with validation warnings', async () => {
    const deps = {
      ...buildDeps({
        suggestion: blockedWorkflowSuggestion,
        suggestions: [blockedWorkflowSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: false, warnings: [], errors: ['Required input remains unbound.'] },
      }),
      intentValue: 'Build invoice reconciliation workflow',
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({
        constructionId: 'construction-blocked',
        playbookId: 'p1',
        baseDefinitionRevision: 7,
      }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({
          type: 'node_delta',
          constructionId: 'construction-blocked',
          playbookId: 'p1',
          sequence: 1,
          suggestion: blockedWorkflowSuggestion,
        } as any);
        options.onEvent({
          type: 'edge_delta',
          constructionId: 'construction-blocked',
          playbookId: 'p1',
          sequence: 2,
          suggestion: blockedWorkflowSuggestion,
        } as any);
        options.onEvent({ type: 'completed', constructionId: 'construction-blocked', playbookId: 'p1', sequence: 3 } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleForceGenerateIntent();
    });

    expect(deps.captureConstructionSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledTimes(1);
    expect(deps.finalizeConstruction).toHaveBeenCalledWith(7, 'construction-blocked');
    expect(deps.showWarning).not.toHaveBeenCalled();
  });

  it('applies only the largest cumulative workflow plan after completion', async () => {
    const changes = [
      {
        type: 'create_node' as const,
        nodeRef: 'source',
        anchor: { mode: 'append' as const, targetTaskId: null, nodeRef: null },
        task: { title: 'Source', description: 'Produce data.', outputPorts: [{ id: 'result', artifactKind: 'data' as const }] },
      },
      {
        type: 'create_node' as const,
        nodeRef: 'target',
        anchor: { mode: 'append' as const, targetTaskId: null, nodeRef: null },
        task: { title: 'Target', description: 'Consume data.', inputPorts: [{ id: 'input', artifactKind: 'data' as const, required: true }] },
      },
      {
        type: 'create_edge' as const,
        sourceTaskId: null,
        sourceNodeRef: 'source',
        targetTaskId: null,
        targetNodeRef: 'target',
        sourcePort: 'result',
        targetPort: 'input',
        edgeKind: 'sequential' as const,
      },
      {
        type: 'create_data_binding' as const,
        sourceKind: 'node-output' as const,
        sourceTaskId: null,
        sourceNodeRef: 'source',
        sourcePort: 'result',
        targetTaskId: null,
        targetNodeRef: 'target',
        targetPort: 'input',
        iteration: 'current' as const,
      },
    ];
    const cumulativePlan = (count: number): PlaybookIntentSuggestion => ({
      id: 'cumulative-plan',
      kind: 'workflow_plan',
      label: 'Cumulative plan',
      summary: 'Build a connected graph.',
      reason: 'Test cumulative streaming.',
      confidence: 0.9,
      impact: {
        nodesToCreate: Math.min(count, 2),
        nodesToUpdate: 0,
        nodesToDelete: 0,
        edgesToCreate: count >= 3 ? 1 : 0,
        edgesToDelete: 0,
        dataBindingsToCreate: count >= 4 ? 1 : 0,
        dataBindingsToDelete: 0,
        affectedTaskIds: [],
        businessOutcome: '',
      },
      changes: changes.slice(0, count),
      isDirectIntentFallback: false,
    });
    const finalPlan = cumulativePlan(4);
    const deps = {
      ...buildDeps({
        suggestion: finalPlan,
        suggestions: [finalPlan],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      intentValue: 'Build connected workflow',
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({
        constructionId: 'construction-cumulative',
        playbookId: 'p1',
        baseDefinitionRevision: 7,
      }),
      streamPlaybookIntentConstruction: vi.fn(async (_playbookId, _constructionId, options) => {
        options.onEvent({ type: 'node_delta', constructionId: 'construction-cumulative', playbookId: 'p1', sequence: 1, suggestion: cumulativePlan(1) } as any);
        options.onEvent({ type: 'data_binding_delta', constructionId: 'construction-cumulative', playbookId: 'p1', sequence: 2, suggestion: finalPlan } as any);
        options.onEvent({ type: 'edge_delta', constructionId: 'construction-cumulative', playbookId: 'p1', sequence: 3, suggestion: cumulativePlan(3) } as any);
        options.onEvent({ type: 'completed', constructionId: 'construction-cumulative', playbookId: 'p1', sequence: 4 } as any);
      }),
      captureConstructionSnapshot: vi.fn(),
      rollbackConstruction: vi.fn(),
      finalizeConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleForceGenerateIntent();
    });

    expect(deps.captureConstructionSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledTimes(1);
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(finalPlan, expect.objectContaining({
      applicationKey: 'intent-construction-construction-cumulative',
      save: false,
    }));
    expect(deps.finalizeConstruction).toHaveBeenCalledWith(7, 'construction-cumulative');
    expect(deps.rollbackConstruction).not.toHaveBeenCalled();
  });

  it('marks explicit construction as starting before dirty-save completes', async () => {
    const saveNow = vi.fn().mockResolvedValue(undefined);
    const deps = {
      ...buildDeps({
        suggestion: validStepSuggestion,
        suggestions: [validStepSuggestion],
        intent: 'Build workflow.',
        expectedDefinitionRevision: 7,
        validation: { valid: true, warnings: [], errors: [] },
      }),
      isDirty: true,
      intentValue: 'Build invoice reconciliation workflow',
      saveNow,
      requestPlaybookIntent: vi.fn().mockResolvedValue({ suggestions: [] }),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({
        constructionId: 'construction-2',
        playbookId: 'p1',
        baseDefinitionRevision: 7,
      }),
      streamPlaybookIntentConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleForceGenerateIntent();
    });

    expect(deps.setConstructionStatus).toHaveBeenCalledWith('starting');
    expect(deps.setConstructionProgress).toHaveBeenCalledWith('intentBar.construction.starting');
    expect(deps.setConstructionStatus.mock.invocationCallOrder[0]).toBeLessThan(saveNow.mock.invocationCallOrder[0]);
    expect(deps.startPlaybookIntentConstruction).toHaveBeenCalledWith('p1', {
      intent: 'Build invoice reconciliation workflow',
      selectedTaskId: 't1',
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('starts a durable Advisor preview with empty selected findings', async () => {
    const deps = buildDeps({
      suggestion: validStepSuggestion,
      suggestions: [validStepSuggestion],
      intent: 'Optimize the selected step.',
      expectedDefinitionRevision: 7,
      validation: { valid: true, warnings: [], errors: [] },
    });
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleApplyAdvisorIntent({
        mode: 'optimize-step',
        executionId: 'exec-1',
        items: [],
        selectedTaskId: 't1',
      });
    });

    expect(deps.startAdvisorRemediationConstruction).toHaveBeenCalledWith('p1', {
      mode: 'optimize-step',
      executionId: 'exec-1',
      items: [],
      selectedTaskId: 't1',
      expectedDefinitionRevision: 7,
    });
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(validStepSuggestion, expect.objectContaining({ save: false }));
    expect(deps.setPreviewConstructionReady).toHaveBeenCalledWith('advisor-operation', 7);
  });

  it('rejects optimize-step preview suggestions that are not selected-node updates', async () => {
    const invalidSuggestion = {
      ...validStepSuggestion,
      operationType: 'delete_node',
    } as PlaybookIntentSuggestion;
    const deps = buildDeps({
      suggestion: invalidSuggestion,
      suggestions: [invalidSuggestion],
      intent: 'Optimize the selected step.',
      expectedDefinitionRevision: 7,
      validation: { valid: false, warnings: [], errors: ['Invalid operation.'] },
    });
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await expect(result.current.handleApplyAdvisorIntent({
      mode: 'optimize-step',
      executionId: 'exec-1',
      items: [],
      selectedTaskId: 't1',
    })).rejects.toThrow('detail.remediation.noApplicableSuggestion');

    expect(deps.handleApplyIntentSuggestion).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledWith('detail.remediation.noApplicableSuggestion');
  });
});
