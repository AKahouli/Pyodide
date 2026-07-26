import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { EvaluationSettingsPage } from './EvaluationSettingsPage';
import { getAdminEvaluationSettings, getAllModels, updateAdminEvaluationSettings } from '../api';

vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return {
    ...actual,
    useModuleTranslation: () => ({
      t: (key: string) => key,
      ready: true,
      language: 'en',
    }),
  };
});

vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('../api', () => ({
  getAdminEvaluationSettings: vi.fn(),
  getAllModels: vi.fn(),
  updateAdminEvaluationSettings: vi.fn(),
}));

const legacySettings = {
  responseReliability: {
    enabled: false,
    mode: 'informative' as const,
    judgeModelId: null,
    maxConcurrentEvaluations: 3,
    timeoutMs: 30000,
    maxFindings: 5,
  },
};

describe('EvaluationSettingsPage corrective settings', () => {
  beforeEach(() => {
    vi.mocked(getAdminEvaluationSettings).mockReset();
    vi.mocked(getAllModels).mockReset();
    vi.mocked(updateAdminEvaluationSettings).mockReset();
    vi.mocked(getAdminEvaluationSettings).mockResolvedValue(legacySettings);
    vi.mocked(getAllModels).mockResolvedValue({ models: [], total: 0 });
  });

  it('normalizes legacy settings and submits the transparent corrective contract', async () => {
    vi.mocked(updateAdminEvaluationSettings).mockImplementation(async (value) => value);
    const { user } = renderWithProviders(<EvaluationSettingsPage />);

    await screen.findByText('Corrective — transparent');
    await user.click(screen.getByText('Corrective — transparent'));

    expect(screen.getByLabelText('Correction threshold')).toHaveValue(70);
    expect(screen.getByLabelText('Maximum correction attempts')).toHaveValue(1);
    expect(screen.getByLabelText('Maximum correction duration')).toHaveValue(60);

    await user.clear(screen.getByLabelText('Correction threshold'));
    await user.type(screen.getByLabelText('Correction threshold'), '75');
    await user.click(screen.getByRole('button', { name: 'evaluationSettings.save' }));

    await waitFor(() => expect(updateAdminEvaluationSettings).toHaveBeenCalledWith({
      responseReliability: expect.objectContaining({
        mode: 'corrective_transparent',
        correction: {
          threshold: 75,
          maxAttempts: 1,
          maxDurationMs: 60000,
          allowAdditionalDocumentRetrieval: false,
          allowConnectorQueries: false,
          allowCalculationReruns: false,
          failureBehavior: 'publish_with_warning',
          showOriginalAnswer: true,
        },
      }),
    }));
  });

  it('shows guarded mode as unavailable', async () => {
    renderWithProviders(<EvaluationSettingsPage />);
    await screen.findByText('Corrective — guarded');
    expect(screen.getByRole('radio', { name: /Corrective — guarded/ })).toBeDisabled();
    expect(screen.getByText('Coming later')).toBeInTheDocument();
  });
});
