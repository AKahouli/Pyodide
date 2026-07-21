import { beforeEach, describe, expect, it } from 'vitest';

import { usePlaybookUiStore } from './uiStore';

describe('playbook ui store', () => {
  beforeEach(() => {
    localStorage.clear();
    usePlaybookUiStore.getState().reset();
  });

  it('persists the execution sidebar preference across resets', () => {
    usePlaybookUiStore.getState().setExecutionPanelOpen(true);

    expect(localStorage.getItem('ys_playbook_exec_panel')).toBe('1');

    usePlaybookUiStore.setState({ executionPanelOpen: false });
    usePlaybookUiStore.getState().reset();

    expect(usePlaybookUiStore.getState().executionPanelOpen).toBe(true);
  });

  it('persists the workspace explorer preference across resets', () => {
    usePlaybookUiStore.getState().setWorkspaceExplorerOpen(true);

    expect(localStorage.getItem('ys_workspace_explorer_open')).toBe('1');

    usePlaybookUiStore.setState({ workspaceExplorerOpen: false });
    usePlaybookUiStore.getState().reset();

    expect(usePlaybookUiStore.getState().workspaceExplorerOpen).toBe(true);
    expect(usePlaybookUiStore.getState().executionPanelOpen).toBe(false);
  });

  it('owns the durable assistant preview lifecycle', () => {
    usePlaybookUiStore.getState().setAssistantOperation({
      id: 'advisor-1',
      target: 'advisor_preview',
      baseDefinitionRevision: 7,
      status: 'ready',
    });

    expect(usePlaybookUiStore.getState()).toMatchObject({
      assistantOperationId: 'advisor-1',
      assistantOperationTarget: 'advisor_preview',
      assistantBaseDefinitionRevision: 7,
      assistantPreviewStatus: 'ready',
    });

    usePlaybookUiStore.getState().setAssistantPreviewStatus('applying');
    expect(usePlaybookUiStore.getState().assistantPreviewStatus).toBe('applying');

    usePlaybookUiStore.getState().clearAssistantOperation();
    expect(usePlaybookUiStore.getState()).toMatchObject({
      assistantOperationId: null,
      assistantOperationTarget: null,
      assistantBaseDefinitionRevision: null,
      assistantPreviewStatus: 'idle',
    });
  });
});
