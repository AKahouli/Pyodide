import { describe, expect, it, vi } from 'vitest';
import { dedupeSecondBrainUiTargets, executeSecondBrainUiTarget, findUiTargets, getSecondBrainUiTargetIdentity } from './action-bus';
import type { SecondBrainPageContext } from './types';

const context: SecondBrainPageContext = {
  route: '/playbooks',
  module: 'playbooks',
  surface: 'playbook.list',
  availableActions: ['open'],
  hasUnsavedChanges: false,
  locale: 'en',
  contextVersion: 1,
};

describe('second brain action bus', () => {
  it('resolves allowlisted semantic targets to local routes', () => {
    const navigate = vi.fn();
    expect(executeSecondBrainUiTarget({
      target: { surface: 'playbook.execution.task', params: { playbookId: 'p/1', executionId: 'e/1', taskId: 't/1' } },
      pageContext: context,
      navigate,
      confirmNavigation: () => true,
    })).toEqual({ ok: true });
    expect(navigate).toHaveBeenCalledWith('/playbooks/p%2F1/executions/e%2F1?taskId=t%2F1');
  });

  it('rejects unknown surfaces and arbitrary route fields', () => {
    const navigate = vi.fn();
    const result = executeSecondBrainUiTarget({
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
    const result = executeSecondBrainUiTarget({
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
    const result = executeSecondBrainUiTarget({
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
    const targets = dedupeSecondBrainUiTargets([
      editor,
      { ...editor, effects: [{ type: 'highlightTask', taskId: 'task-1' }] },
      { surface: 'playbook.editor.assistant', params: { playbookId: 'p1', operationId: 'op1' } },
      { surface: 'playbook.editor.assistant', params: { playbookId: 'p1', operationId: 'op2' } },
    ]);

    expect(targets).toHaveLength(4);
    expect(targets[0]).toBe(editor);
    expect(targets.map(getSecondBrainUiTargetIdentity)).toEqual([
      '["playbook.editor","p1",[]]',
      '["playbook.editor","p1",[{"type":"highlightTask","taskId":"task-1"}]]',
      '["playbook.editor.assistant","p1","op1",[]]',
      '["playbook.editor.assistant","p1","op2",[]]',
    ]);
  });

  it('rejects the removed selectTab effect instead of silently dropping it', () => {
    const navigate = vi.fn();
    expect(executeSecondBrainUiTarget({
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
