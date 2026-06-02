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
});
