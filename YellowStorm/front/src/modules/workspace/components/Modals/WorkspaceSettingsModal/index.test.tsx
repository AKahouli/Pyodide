import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSettingsModal } from './index';

const closeSettingsModalMock = vi.fn();
const updateCurrentWorkspaceSettingsMock = vi.fn(async () => undefined);
const assignSettingsToWorkspaceMock = vi.fn(async () => undefined);
const clearWorkspaceSettingsMock = vi.fn(async () => undefined);
const createSettingMock = vi.fn(async () => ({ id: 's-new' }));
const fetchTemplatesMock = vi.fn();

const state = {
  isLoadingSettings: false,
  isSavingSettings: false,
  isLoadingTemplates: false,
  currentSettings: {
    id: 's-1',
    name: 'Current',
    isTemplate: true,
    isPredefined: false,
    createdBy: 'u-1',
    chunks: 5,
    ragType: 'standard' as const,
    topK: 10,
    maxToken: 32000,
    hybridSearch: false,
    createdAt: '',
    updatedAt: '',
  },
};

vi.mock('../../../store', () => ({
  useWorkspaceModalState: () => ({ isSettingsModalOpen: true }),
  useWorkspaceLoading: () => ({ isLoadingSettings: state.isLoadingSettings, isSavingSettings: state.isSavingSettings, isLoadingTemplates: state.isLoadingTemplates }),
  useCurrentWorkspaceSettings: () => state.currentSettings,
  useSettingsTargetWorkspace: () => ({ id: 'w-1', name: 'Workspace A' }),
  useWorkspaceStore: (selector: (s: {
    closeSettingsModal: typeof closeSettingsModalMock;
    updateCurrentWorkspaceSettings: typeof updateCurrentWorkspaceSettingsMock;
    assignSettingsToWorkspace: typeof assignSettingsToWorkspaceMock;
    clearWorkspaceSettings: typeof clearWorkspaceSettingsMock;
    createSetting: typeof createSettingMock;
    templates: Array<{ id: string; name: string; isTemplate: true; isPredefined: boolean; createdBy: string; chunks: number; ragType: 'standard'; topK: number; maxToken: number; hybridSearch: boolean; createdAt: string; updatedAt: string }>;
    fetchTemplates: typeof fetchTemplatesMock;
  }) => unknown) =>
    selector({
      closeSettingsModal: closeSettingsModalMock,
      updateCurrentWorkspaceSettings: updateCurrentWorkspaceSettingsMock,
      assignSettingsToWorkspace: assignSettingsToWorkspaceMock,
      clearWorkspaceSettings: clearWorkspaceSettingsMock,
      createSetting: createSettingMock,
      templates: [
        {
          id: 'tpl-1',
          name: 'Template 1',
          isTemplate: true,
          isPredefined: true,
          createdBy: 'u-1',
          chunks: 4,
          ragType: 'standard',
          topK: 5,
          maxToken: 4000,
          hybridSearch: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      fetchTemplates: fetchTemplatesMock,
    }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/scroll-area', () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./SettingsHeader', () => ({ SettingsHeader: () => <div>settings-header</div> }));
vi.mock('./CurrentSettingsCard', () => ({ CurrentSettingsCard: ({ onClear }: { onClear: () => void }) => <button onClick={onClear}>clear-current</button> }));
vi.mock('./TemplateSelector', () => ({ TemplateSelector: ({ onApply }: { onApply: (id: string) => void }) => <button onClick={() => onApply('tpl-1')}>apply-template</button> }));
vi.mock('./SettingsFormSection', () => ({
  SettingsFormSection: ({ onSubmit }: { onSubmit: (data: { chunks: number; ragType: 'standard'; maxToken: number; topK: number; hybridSearch: boolean; instruction: string }) => void }) => (
    <button onClick={() => onSubmit({ instruction: 'I', chunks: 5, ragType: 'standard', maxToken: 4096, topK: 10, hybridSearch: false })}>submit-settings</button>
  ),
}));

describe('WorkspaceSettingsModal', () => {
  beforeEach(() => {
    fetchTemplatesMock.mockReset();
    updateCurrentWorkspaceSettingsMock.mockReset();
    assignSettingsToWorkspaceMock.mockReset();
    clearWorkspaceSettingsMock.mockReset();
    state.isLoadingSettings = false;
    state.currentSettings = {
      id: 's-1',
      name: 'Current',
      isTemplate: true,
      isPredefined: false,
      createdBy: 'u-1',
      chunks: 5,
      ragType: 'standard',
      topK: 10,
      maxToken: 32000,
      hybridSearch: false,
      createdAt: '',
      updatedAt: '',
    };
  });

  it('fetches templates and delegates child actions', async () => {
    render(<WorkspaceSettingsModal />);

    expect(fetchTemplatesMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'apply-template' }));
    expect(assignSettingsToWorkspaceMock).toHaveBeenCalledWith('tpl-1');

    await userEvent.click(screen.getByRole('button', { name: 'clear-current' }));
    await waitFor(() => expect(clearWorkspaceSettingsMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'submit-settings' }));
    await waitFor(() => expect(updateCurrentWorkspaceSettingsMock).toHaveBeenCalled());
  });

  it('shows loading state while settings are loading', () => {
    state.isLoadingSettings = true;
    render(<WorkspaceSettingsModal />);
    expect(screen.getByText('settings-header')).toBeInTheDocument();
  });
});
