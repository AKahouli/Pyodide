import { describe, expect, it, vi } from 'vitest';
import { dedupePlatformCopilotUiTargets, executePlatformCopilotUiTarget, findUiTargets, getPlatformCopilotUiTargetIdentity } from './action-bus';
import type { PlatformCopilotPageContext } from './types';

const context: PlatformCopilotPageContext = {
  route: '/playbooks',
  module: 'playbooks',
  surface: 'playbook.list',
  availableActions: ['open'],
  hasUnsavedChanges: false,
  locale: 'en',
  contextVersion: 1,
};

describe('platform copilot action bus', () => {
  it('resolves allowlisted semantic targets to local routes', () => {
    const navigate = vi.fn();
    expect(executePlatformCopilotUiTarget({
      target: { surface: 'playbook.execution.task', params: { playbookId: 'p/1', executionId: 'e/1', taskId: 't/1' } },
      pageContext: context,
      navigate,
      confirmNavigation: () => true,
    })).toEqual({ ok: true });
    expect(navigate).toHaveBeenCalledWith('/playbooks/p%2F1/executions/e%2F1?taskId=t%2F1');
  });

  it('rejects unknown surfaces and arbitrary route fields', () => {
    const navigate = vi.fn();
    const result = executePlatformCopilotUiTarget({
      target: { surface: 'external.url', params: {}, url: 'https://example.com' } as never,
      pageContext: context,
      navigate,
      confirmNavigation: () => true,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_target' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('preserves unsaved changes when the user cancels navigation', () => {
    const navigate = vi.fn();
    const result = executePlatformCopilotUiTarget({
      target: { surface: 'playbook.editor', params: { playbookId: 'p1' } },
      pageContext: { ...context, hasUnsavedChanges: true },
      navigate,
      confirmNavigation: () => false,
    });
    expect(result).toEqual({ ok: false, reason: 'navigation_cancelled' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens an operation-owned draft in the Canvas assistant', () => {
    const navigate = vi.fn();
    const result = executePlatformCopilotUiTarget({
      target: {
        surface: 'playbook.editor.assistant',
        params: { playbookId: 'p1', operationId: 'operation/1' },
      },
      pageContext: context,
      navigate,
      confirmNavigation: () => true,
    });
    expect(result).toEqual({ ok: true });
    expect(navigate).toHaveBeenCalledWith('/playbooks/p1?assistantOperation=operation%2F1');
  });

  it('finds nested UI targets without accepting untyped output', () => {
    expect(findUiTargets({ data: { uiTarget: { surface: 'playbook.editor', params: { playbookId: 'p1' } } } }))
      .toEqual([{ surface: 'playbook.editor', params: { playbookId: 'p1' } }]);
    expect(findUiTargets({ uiTarget: { surface: 'javascript', params: {} } })).toEqual([]);
  });

  it('deduplicates equivalent destinations while preserving distinct operations', () => {
    const editor = { surface: 'playbook.editor' as const, params: { playbookId: 'p1' } };
    const targets = dedupePlatformCopilotUiTargets([
      editor,
      { ...editor, effects: [{ type: 'highlightTask', taskId: 'task-1' }] },
      { surface: 'playbook.editor.assistant', params: { playbookId: 'p1', operationId: 'op1' } },
      { surface: 'playbook.editor.assistant', params: { playbookId: 'p1', operationId: 'op2' } },
    ]);

    expect(targets).toHaveLength(4);
    expect(targets[0]).toBe(editor);
    expect(targets.map(getPlatformCopilotUiTargetIdentity)).toEqual([
      '["playbook.editor","p1",[]]',
      '["playbook.editor","p1",[{"type":"highlightTask","taskId":"task-1"}]]',
      '["playbook.editor.assistant","p1","op1",[]]',
      '["playbook.editor.assistant","p1","op2",[]]',
    ]);
  });

  it('rejects the removed selectTab effect instead of silently dropping it', () => {
    const navigate = vi.fn();
    expect(executePlatformCopilotUiTarget({
      target: {
        surface: 'playbook.execution.details',
        params: { playbookId: 'p1', executionId: 'e1' },
        effects: [{ type: 'selectTab', tab: 'arbitrary' }],
      } as never,
      pageContext: context,
      navigate,
      confirmNavigation: () => true,
    })).toEqual({ ok: false, reason: 'invalid_target' });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('semantic model targets', () => {
  it('open the model, or its suggested sources, by id and are told apart by model', () => {
    const navigate = vi.fn();
    const editor = { surface: 'semanticModel.editor' as const, params: { modelId: 'm/1', modelName: 'Billing' } };
    expect(executePlatformCopilotUiTarget({ target: editor, pageContext: context, navigate, confirmNavigation: () => true })).toEqual({ ok: true });
    expect(navigate).toHaveBeenLastCalledWith('/semantic-models/m%2F1');
    executePlatformCopilotUiTarget({ target: { ...editor, surface: 'semanticModel.sources' }, pageContext: context, navigate, confirmNavigation: () => true });
    expect(navigate).toHaveBeenLastCalledWith('/semantic-models/m%2F1?sources=1');
    expect(executePlatformCopilotUiTarget({ target: { surface: 'semanticModel.editor', params: {} }, pageContext: context, navigate, confirmNavigation: () => true }))
      .toEqual({ ok: false, reason: 'missing_parameter' });
    expect(dedupePlatformCopilotUiTargets([editor, { ...editor, params: { modelId: 'm/1', modelName: 'Renamed' } }])).toHaveLength(1);
    expect(getPlatformCopilotUiTargetIdentity(editor)).not.toBe(getPlatformCopilotUiTargetIdentity({ ...editor, params: { modelId: 'm/2' } }));
    expect(findUiTargets(JSON.stringify({ data: { uiTarget: editor } }))).toEqual([editor]);
  });
});
