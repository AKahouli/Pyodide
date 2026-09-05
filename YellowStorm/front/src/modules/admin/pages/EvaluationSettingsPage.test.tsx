import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { EvaluationSettingsPage } from './EvaluationSettingsPage';
import { getAdminEvaluationSettings, getAllModels, updateAdminEvaluationSettings } from '../api';

const translationMocks = vi.hoisted(() => ({
  t: (key: string) => key,
}));

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'admin' } }) }));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translationMocks.t }) };
});
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('../api', () => ({
  getAdminEvaluationSettings: vi.fn(),
  getAllModels: vi.fn(),
  updateAdminEvaluationSettings: vi.fn(),
}));

const settings = {
  responseReliability: {
    enabled: true,
    mode: 'informative' as const,
    judgeModelId: 'model-1',
    maxConcurrentEvaluations: 3,
    timeoutMs: 30000,
    maxFindings: 5,
    correction: {
      threshold: 70,
      maxAttempts: 1,
      maxDurationMs: 60000,
      allowAdditionalDocumentRetrieval: false,
      allowConnectorQueries: false,
      allowCalculationReruns: false,
      failureBehavior: 'publish_with_warning' as const,
      showOriginalAnswer: true,
    },
  },
};

describe('EvaluationSettingsPage', () => {
  beforeEach(() => {
    vi.mocked(getAdminEvaluationSettings).mockResolvedValue(settings);
    vi.mocked(getAllModels).mockResolvedValue({ models: [{ id: 'model-1', name: 'Judge', isActive: true, types: ['chat'], type: 'chat' }] } as never);
    vi.mocked(updateAdminEvaluationSettings).mockImplementation(async (value) => value);
  });

  it('shows guarded and recovery controls as disabled', async () => {
    const { user } = renderWithProviders(<EvaluationSettingsPage />);
    const guarded = await screen.findByLabelText(/evaluationSettings.correctiveGuarded/);
    expect(guarded).toBeDisabled();

    await user.click(screen.getByLabelText(/evaluationSettings.correctiveTransparent/));

    expect(await screen.findByLabelText('evaluationSettings.correction.additionalRetrieval')).toBeDisabled();
    expect(screen.getByLabelText('evaluationSettings.correction.connectorQueries')).toBeDisabled();
    expect(screen.getByLabelText('evaluationSettings.correction.calculationReruns')).toBeDisabled();
  });

  it('saves transparent correction settings in milliseconds', async () => {
    vi.mocked(getAdminEvaluationSettings).mockResolvedValue({
      responseReliability: { ...settings.responseReliability, mode: 'corrective_transparent' },
    });
    const { user } = renderWithProviders(<EvaluationSettingsPage />);
    await screen.findByLabelText('evaluationSettings.correction.maxDuration');
    const duration = screen.getByLabelText('evaluationSettings.correction.maxDuration');
    expect(duration).toHaveValue(60);
    expect(duration).not.toHaveAttribute('max');
    fireEvent.change(duration, { target: { value: '301' } });
    expect(screen.getByRole('button', { name: 'evaluationSettings.save' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'evaluationSettings.save' }));
    await waitFor(() => expect(updateAdminEvaluationSettings).toHaveBeenCalledWith(expect.objectContaining({
      responseReliability: expect.objectContaining({
        mode: 'corrective_transparent',
        correction: expect.objectContaining({ maxDurationMs: 301000 }),
      }),
    })));
  });

  it('does not apply maximum values to numeric settings', async () => {
    vi.mocked(getAdminEvaluationSettings).mockResolvedValue({
      responseReliability: { ...settings.responseReliability, mode: 'corrective_transparent' },
    });
    const { user } = renderWithProviders(<EvaluationSettingsPage />);
    const concurrency = await screen.findByLabelText('evaluationSettings.concurrency');
    const timeout = screen.getByLabelText('evaluationSettings.timeout');
    const findings = screen.getByLabelText('evaluationSettings.maxFindings');
    const threshold = screen.getByLabelText('evaluationSettings.correction.threshold');
    const attempts = screen.getByLabelText('evaluationSettings.correction.maxAttempts');

    expect(concurrency).not.toHaveAttribute('max');
    expect(timeout).not.toHaveAttribute('max');
    expect(findings).not.toHaveAttribute('max');
    expect(threshold).not.toHaveAttribute('max');
    expect(attempts).not.toHaveAttribute('max');

    fireEvent.change(concurrency, { target: { value: '11' } });
    fireEvent.change(timeout, { target: { value: '121' } });
    fireEvent.change(findings, { target: { value: '11' } });
    fireEvent.change(threshold, { target: { value: '101' } });
    fireEvent.change(attempts, { target: { value: '4' } });
    expect(screen.getByRole('button', { name: 'evaluationSettings.save' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'evaluationSettings.save' }));
    await waitFor(() => expect(updateAdminEvaluationSettings).toHaveBeenCalledWith(expect.objectContaining({
      responseReliability: expect.objectContaining({
        maxConcurrentEvaluations: 11,
        timeoutMs: 121000,
        maxFindings: 11,
        correction: expect.objectContaining({ threshold: 101, maxAttempts: 4 }),
      }),
    })));
  });
});
