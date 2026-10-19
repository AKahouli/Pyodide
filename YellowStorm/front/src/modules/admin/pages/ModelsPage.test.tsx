import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ModelsPage } from './ModelsPage';
import { getAllModels, updateModel } from '../api';

const translateMock = vi.hoisted(() => (key: string) => key);
const useAuthMock = vi.hoisted(() => vi.fn(() => ({ isAuthenticated: true, user: { id: 'admin' } })));
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translateMock, ready: true, language: 'en' }) };
});
vi.mock('../api', () => ({
  getAllModels: vi.fn(),
  updateModel: vi.fn(),
  setDefaultModel: vi.fn(),
  clearDefaultModel: vi.fn(),
  setAppBuilderDefaultModel: vi.fn(),
  clearAppBuilderDefaultModel: vi.fn(),
  syncModels: vi.fn(),
}));

const model = {
  id: 'text-model',
  name: 'Text Model',
  chef: 'OpenAI',
  chefSlug: 'openai',
  litellmModel: 'openai/text-model',
  providers: ['openai'],
  type: 'chat',
  types: ['chat'],
  isActive: true,
  isDefault: false,
  __WIRE__isConversationV2Default__: false,
  omitTemperature: false,
  inputModalities: ['text'] as Array<'text' | 'image'>,
  maxInputTokens: null,
  maxOutputTokens: null,
  supportsReasoning: null,
  reasoning: { efforts: [] },
};

describe('ModelsPage', () => {
  beforeEach(() => {
    vi.mocked(getAllModels).mockReset();
    vi.mocked(updateModel).mockReset();
    vi.mocked(getAllModels).mockResolvedValue({ models: [model], total: 1 });
    vi.mocked(updateModel).mockResolvedValue({ ...model, inputModalities: ['text', 'image'] });
  });

  it('keeps text mandatory and saves the optional image modality', async () => {
    const { user } = renderWithProviders(<ModelsPage />);
    await user.click(await screen.findByRole('button', { name: 'models.table.actions.edit' }));

    const text = screen.getByLabelText('models.edit.fields.inputModalities.text');
    const image = screen.getByLabelText('models.edit.fields.inputModalities.image');
    expect(text).toBeChecked();
    expect(text).toBeDisabled();
    expect(image).not.toBeChecked();

    await user.click(image);
    await user.click(screen.getByRole('button', { name: 'models.edit.actions.save' }));

    await waitFor(() => expect(updateModel).toHaveBeenCalledWith(
      'text-model',
      expect.objectContaining({ inputModalities: ['text', 'image'], defaultReasoningEffort: null }),
    ));
  });
  it.each([
    { initial: undefined, selected: 'responses', initialLabel: 'chatCompletions', selectedLabel: 'responses' },
    { initial: 'responses' as const, selected: 'chat_completions', initialLabel: 'responses', selectedLabel: 'chatCompletions' },
  ])('saves the selected conversation API ($selected)', async ({ initial, selected, initialLabel, selectedLabel }) => {
    vi.mocked(getAllModels).mockResolvedValue({ models: [{ ...model, conversationApi: initial }], total: 1 });
    const { user } = renderWithProviders(<ModelsPage />);
    await user.click(await screen.findByRole('button', { name: 'models.table.actions.edit' }));

    const api = screen.getByRole('combobox', { name: 'models.edit.fields.conversationApi' });
    expect(api).toHaveTextContent(`models.edit.fields.conversationApi.${initialLabel}`);
    await user.click(api);
    await user.click(await screen.findByRole('option', { name: `models.edit.fields.conversationApi.${selectedLabel}` }));
    await user.click(screen.getByRole('button', { name: 'models.edit.actions.save' }));

    await waitFor(() => expect(updateModel).toHaveBeenCalledWith(
      'text-model', expect.objectContaining({ conversationApi: selected }),
    ));
  });

  it('hides Responses controls for legacy models and saves safe defaults', async () => {
    const { user } = renderWithProviders(<ModelsPage />);
    await user.click(await screen.findByRole('button', { name: 'models.table.actions.edit' }));
    expect(screen.queryByRole('combobox', { name: 'models.edit.fields.reasoningHistory' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'models.edit.actions.save' }));
    await waitFor(() => expect(updateModel).toHaveBeenCalledWith('text-model', expect.objectContaining({
      conversationApi: 'chat_completions', responsesHistoryMode: 'application', reasoningHistory: 'auto', reasoningSummary: 'off',
    })));
  });

  it('saves independent application replay and summary preferences', async () => {
    vi.mocked(getAllModels).mockResolvedValue({ models: [{ ...model, conversationApi: 'responses', reasoningHistory: 'last', reasoningSummary: 'auto' }], total: 1 });
    const { user } = renderWithProviders(<ModelsPage />);
    await user.click(await screen.findByRole('button', { name: 'models.table.actions.edit' }));
    const replay = screen.getByRole('combobox', { name: 'models.edit.fields.reasoningHistory' });
    expect(replay).toHaveTextContent('models.edit.fields.reasoningHistory.last');
    await user.click(replay);
    await user.click(await screen.findByRole('option', { name: 'models.edit.fields.reasoningHistory.all' }));
    await user.click(screen.getByRole('combobox', { name: 'models.edit.fields.reasoningSummary' }));
    await user.click(await screen.findByRole('option', { name: 'models.edit.fields.reasoningSummary.detailed' }));
    await user.click(screen.getByRole('button', { name: 'models.edit.actions.save' }));
    await waitFor(() => expect(updateModel).toHaveBeenCalledWith('text-model', expect.objectContaining({
      responsesHistoryMode: 'application', reasoningHistory: 'all', reasoningSummary: 'detailed',
    })));
  });

  it('forces Auto replay for provider history and preserves dormant settings for Completions', async () => {
    vi.mocked(getAllModels).mockResolvedValue({ models: [{ ...model, conversationApi: 'responses', reasoningHistory: 'last', reasoningSummary: 'concise' }], total: 1 });
    const { user } = renderWithProviders(<ModelsPage />);
    await user.click(await screen.findByRole('button', { name: 'models.table.actions.edit' }));
    await user.click(screen.getByRole('combobox', { name: 'models.edit.fields.responsesHistoryMode' }));
    await user.click(await screen.findByRole('option', { name: 'models.edit.fields.responsesHistoryMode.provider' }));
    expect(screen.getByRole('combobox', { name: 'models.edit.fields.reasoningHistory' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'models.edit.fields.reasoningHistory' })).toHaveTextContent('models.edit.fields.reasoningHistory.auto');
    expect(screen.getByText('models.edit.fields.reasoningHistoryProviderHelper')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'models.edit.fields.conversationApi' }));
    await user.click(await screen.findByRole('option', { name: 'models.edit.fields.conversationApi.chatCompletions' }));
    expect(screen.queryByRole('combobox', { name: 'models.edit.fields.reasoningSummary' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'models.edit.actions.save' }));
    await waitFor(() => expect(updateModel).toHaveBeenCalledWith('text-model', expect.objectContaining({
      conversationApi: 'chat_completions', responsesHistoryMode: 'provider', reasoningHistory: 'auto', reasoningSummary: 'concise',
    })));
  });

  it('normalizes persisted provider replay to Auto', async () => {
    vi.mocked(getAllModels).mockResolvedValue({ models: [{ ...model, conversationApi: 'responses', responsesHistoryMode: 'provider', reasoningHistory: 'none' }], total: 1 });
    const { user } = renderWithProviders(<ModelsPage />);
    await user.click(await screen.findByRole('button', { name: 'models.table.actions.edit' }));
    expect(screen.getByRole('combobox', { name: 'models.edit.fields.reasoningHistory' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'models.edit.fields.reasoningHistory' })).toHaveTextContent('models.edit.fields.reasoningHistory.auto');
  });

});
