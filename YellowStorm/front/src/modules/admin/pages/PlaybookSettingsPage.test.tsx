import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/test/renderWithProviders';
import { showError } from '@/lib/notifications';
import {
  getAdminPlaybookSettings,
  getAllModels,
  getPlaybookPlannerAgents,
  updateAdminPlaybookSettings,
} from '../api';
import type { AdminPlaybookSettings } from '../types';
import { PlaybookSettingsPage } from './PlaybookSettingsPage';

const translateMock = vi.hoisted(() => (
  (key: string) => ({
    'playbookSettings.actions.save': 'Save',
    'playbookSettings.execution.title': 'Execution',
    'playbookSettings.execution.dynamicReasoning.planner.label': 'Planner agent',
    'playbookSettings.execution.dynamicReasoning.planner.inferenceFallback': 'Playbook inference model',
    'playbookSettings.inference.title': 'Inference',
    'playbookSettings.intentNormalization.title': 'Intent normalization',
    'playbookSettings.intent.title': 'Intent',
    'playbookSettings.toasts.saveError.title': 'Settings were not saved',
  }[key] ?? key)
));

const settings: AdminPlaybookSettings = {
  inferenceModelId: null,
  advisorEvaluationModelId: null,
  replayEvaluationModelId: null,
  nodeSuggestionsMode: 'manual',
  approvalSuggestionMode: 'auto',
  intentNormalizationLimits: {
    maxWorkflowPlanChanges: 30,
    maxInputPorts: 5,
    maxOutputPorts: 6,
    maxIteratorBodySteps: 13,
    maxIteratorBodyEdges: 25,
  },
  useDeterministicBlueprintBuilder: true,
  playbookExecution: {
    availableCapacity: 50,
    maxConcurrentPerUser: 10,
    maxConcurrentPerFlow: 5,
    maxConcurrentPerProvider: 25,
    maxConcurrentPerModel: 10,
    executionQueueMaxDepth: 50,
    maxParallelismPerExecution: 5,
    recursionLimitDefault: 25,
    recursionLimitMax: 50,
    maxHitlRounds: 5,
    pythonWorkerPoolSize: 8,
    pythonWorkerMaxInflight: 4,
    maxToolIterations: 40,
    graphCacheEnabled: false,
    graphCacheMaxEntries: 128,
    graphCacheTtlSeconds: 900,
    dynamicReasoning: {
      plannerAgentId: 'planner-1',
      maxWorkNodes: 6,
      maxParallelism: 3,
      maxDepth: 1,
      maxRepairAttempts: 1,
    },
  },
};

vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return {
    ...actual,
    useModuleTranslation: () => ({
      t: translateMock,
    }),
  };
});

vi.mock('@/modules/auth/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'admin' } }),
}));

vi.mock('@/lib/notifications', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('@/lib/api-error', () => ({
  parseApiError: () => ({ message: 'The selected planner is unavailable.' }),
}));

vi.mock('../api', () => ({
  getAdminPlaybookSettings: vi.fn(),
  getAllModels: vi.fn(),
  getPlaybookPlannerAgents: vi.fn(),
  updateAdminPlaybookSettings: vi.fn(),
}));

describe('PlaybookSettingsPage', () => {
  beforeEach(() => {
    vi.mocked(getAdminPlaybookSettings).mockResolvedValue(settings);
    vi.mocked(getAllModels).mockResolvedValue({ models: [], total: 0 });
    vi.mocked(getPlaybookPlannerAgents).mockResolvedValue([
      { id: 'planner-1', name: 'Planner', model: 'planner-model' },
    ]);
    vi.mocked(updateAdminPlaybookSettings).mockReset();
    vi.mocked(showError).mockReset();
  });

  it('collapses every settings pane by default', async () => {
    renderWithProviders(<PlaybookSettingsPage />);

    const paneTriggers = screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'));
    expect(paneTriggers).toHaveLength(4);
    paneTriggers.forEach((button) => expect(button).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await waitFor(() => expect(getPlaybookPlannerAgents).toHaveBeenCalled());
  });

  it('keeps a failed save visible and reports the parsed API error', async () => {
    vi.mocked(updateAdminPlaybookSettings).mockRejectedValue(new Error('request failed'));

    const { user } = renderWithProviders(<PlaybookSettingsPage />);
    await user.click(screen.getByRole('button', { name: /Execution/ }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Settings were not saved');
    expect(alert).toHaveTextContent('The selected planner is unavailable.');
    expect(showError).toHaveBeenCalledWith('Settings were not saved', {
      description: 'The selected planner is unavailable.',
    });
    await waitFor(() => expect(updateAdminPlaybookSettings).toHaveBeenCalledWith({
      playbookExecution: settings.playbookExecution,
    }));
  });

  it('provides a dedicated information tooltip trigger for every runtime setting', async () => {
    const { user } = renderWithProviders(<PlaybookSettingsPage />);
    await user.click(screen.getByRole('button', { name: /Execution/ }));

    const keys = [
      'maxConcurrentPerUser', 'executionQueueMaxDepth', 'maxParallelismPerExecution',
      'recursionLimitDefault', 'recursionLimitMax', 'maxHitlRounds', 'pythonWorkerPoolSize',
      'pythonWorkerMaxInflight', 'maxToolIterations', 'graphCacheEnabled',
      'graphCacheMaxEntries', 'graphCacheTtlSeconds',
    ];
    keys.forEach((key) => {
      expect(screen.getByRole('button', {
        name: `playbookSettings.execution.fields.${key}.tooltipLabel`,
      })).toBeInTheDocument();
    });
  });

  it('offers a model-less agent using the Playbook inference fallback', async () => {
    vi.mocked(getPlaybookPlannerAgents).mockResolvedValue([
      { id: 'planner-1', name: 'Playbook Planner', model: null },
    ]);

    const { user } = renderWithProviders(<PlaybookSettingsPage />);
    await user.click(screen.getByRole('button', { name: /Execution/ }));
    await user.click(await screen.findByRole('combobox', { name: 'Planner agent' }));

    expect(await screen.findByRole('option', { name: 'Playbook Planner · Playbook inference model' })).toBeInTheDocument();
  });

  it('saves valid execution settings', async () => {
    vi.mocked(getPlaybookPlannerAgents).mockResolvedValue([
      { id: 'planner-1', name: 'Playbook Planner', model: null },
    ]);
    vi.mocked(updateAdminPlaybookSettings).mockResolvedValue(settings);

    const { user } = renderWithProviders(<PlaybookSettingsPage />);
    await user.click(screen.getByRole('button', { name: /Execution/ }));

    const saveButton = await screen.findByRole('button', { name: 'Save' });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => expect(updateAdminPlaybookSettings).toHaveBeenCalledWith({
      playbookExecution: settings.playbookExecution,
    }));
  });
});
