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
  setConversationV2DefaultModel: vi.fn(),
  clearConversationV2DefaultModel: vi.fn(),
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
  isConversationV2Default: false,
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
});
