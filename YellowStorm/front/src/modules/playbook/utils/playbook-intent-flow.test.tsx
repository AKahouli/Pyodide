import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlaybookIntentFlow } from './playbook-intent-flow';
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

  return {
    id: 'p1',
    playbook,
    selectedStepId: 't1',
    isDirty: false,
    intentValue: '',
    intentAutoApply: false,
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
    showError: vi.fn(),
    getCurrentDefinitionRevision: vi.fn(() => 7),
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
      }),
      saveConstruction: vi.fn().mockResolvedValue(undefined),
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
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(validStepSuggestion, expect.objectContaining({ expectedDefinitionRevision: 7 }));
    expect(deps.saveConstruction).toHaveBeenCalledWith({
      expectedDefinitionRevision: 9,
      clientMutationId: 'intent-construction-construction-clarified',
    });
    expect(deps.setIntentSuggestions).toHaveBeenCalledWith([]);
  });

  it('force generation applies a direct fallback instead of blanking the UI', async () => {
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

    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(fallbackSuggestion, { expectedDefinitionRevision: 7 });
    expect(deps.setIntentSuggestions).toHaveBeenCalledWith([]);
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
      intentAutoApply: true,
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
      }),
      saveConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleSubmitIntent();
    });

    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(validStepSuggestion, expect.objectContaining({
      expectedDefinitionRevision: 7,
    }));
    expect(deps.saveConstruction).toHaveBeenCalledWith({
      expectedDefinitionRevision: 9,
      clientMutationId: 'intent-construction-construction-1',
    });
  });

  it('marks auto-apply construction as starting before dirty-save completes', async () => {
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
      intentAutoApply: true,
      saveNow,
      requestPlaybookIntent: vi.fn().mockResolvedValue({ suggestions: [] }),
      startPlaybookIntentConstruction: vi.fn().mockResolvedValue({
        constructionId: 'construction-2',
        playbookId: 'p1',
        baseDefinitionRevision: 7,
      }),
      streamPlaybookIntentConstruction: vi.fn().mockResolvedValue(undefined),
      saveConstruction: vi.fn().mockResolvedValue(undefined),
      setConstructionStatus: vi.fn(),
      setConstructionProgress: vi.fn(),
      setConstructionId: vi.fn(),
      constructionAbortRef: { current: null },
    };
    const { result } = renderHook(() => usePlaybookIntentFlow(deps));

    await act(async () => {
      await result.current.handleSubmitIntent();
    });

    expect(deps.setConstructionStatus).toHaveBeenCalledWith('starting');
    expect(deps.setConstructionProgress).toHaveBeenCalledWith('intentBar.construction.starting');
    expect(deps.setConstructionStatus.mock.invocationCallOrder[0]).toBeLessThan(saveNow.mock.invocationCallOrder[0]);
    expect(deps.startPlaybookIntentConstruction).toHaveBeenCalledWith('p1', {
      intent: 'Build invoice reconciliation workflow',
      selectedTaskId: 't1',
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('passes empty selected findings to preview instead of blocking optimize-step', async () => {
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

    expect(deps.previewAdvisorRemediation).toHaveBeenCalledWith('p1', {
      mode: 'optimize-step',
      executionId: 'exec-1',
      items: [],
      targetTaskId: 't1',
    });
    expect(deps.handleApplyIntentSuggestion).toHaveBeenCalledWith(validStepSuggestion, { expectedDefinitionRevision: 7 });
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
    expect(deps.setIntentSuggestions).toHaveBeenCalledWith([invalidSuggestion]);
    expect(deps.showError).toHaveBeenCalledWith('detail.remediation.noApplicableSuggestion');
  });
});
