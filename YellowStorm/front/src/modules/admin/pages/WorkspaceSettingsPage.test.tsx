import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/test/renderWithProviders';
import { WorkspaceSettingsPage } from './WorkspaceSettingsPage';
import {
  getAdminWorkspaceEvidenceSearchSettings,
  getAdminWorkspaceUploadSettings,
  getAdminWorkspaceEvidenceSearchConnectors,
  updateAdminWorkspaceEvidenceSearchSettings,
  updateAdminWorkspaceUploadSettings,
} from '../api';
import { __resetAllowedUploadExtensionsCache } from '@/modules/workspace/hooks/useAllowedUploadExtensions';

const useAuthMock = vi.hoisted(() => vi.fn());
const localizationState = vi.hoisted(() => ({ ready: true }));

const TRANSLATIONS: Record<string, string> = {
  'workspaceSettings.title': 'Workspace Settings',
  'workspaceSettings.description': 'Configure global policies.',
  'workspaceSettings.loading': 'Loading...',
  'workspaceSettings.uploads.title': 'Authorized upload extensions',
  'workspaceSettings.uploads.description': 'Choose file extensions.',
  'workspaceSettings.field.label': 'Add an extension',
  'workspaceSettings.field.placeholder': 'pdf, .docx, png',
  'workspaceSettings.field.helper': 'Use a leading dot.',
  'workspaceSettings.actions.add': 'Add',
  'workspaceSettings.actions.save': 'Save changes',
  'workspaceSettings.actions.saving': 'Saving...',
  'workspaceSettings.actions.remove': 'Remove {{value}}',
  'workspaceSettings.list.label': '{{count}} extension(s) authorized',
  'workspaceSettings.list.empty': 'No extension authorized.',
  'workspaceSettings.supported.label': '{{count}} supported extension(s)',
  'workspaceSettings.supported.description': 'Supported extensions description.',
  'workspaceSettings.validation.empty': 'At least one extension is required',
  'workspaceSettings.validation.emptyDescription': 'Users cannot upload.',
  'workspaceSettings.validation.invalid': 'Invalid extension',
  'workspaceSettings.validation.invalidDescription': '"{{value}}" is not a valid file extension.',
  'workspaceSettings.validation.unsupported': 'Unsupported extension',
  'workspaceSettings.validation.unsupportedDescription': '"{{value}}" is not supported by the backend yet.',
  'workspaceSettings.toasts.loadError.title': 'Failed to load settings',
  'workspaceSettings.toasts.loadError.description': 'Try again.',
  'workspaceSettings.toasts.saved.title': 'Upload policy updated',
  'workspaceSettings.toasts.saved.description': 'Workspace upload inputs are now restricted.',
  'workspaceSettings.toasts.saveError.title': 'Failed to save settings',
  'workspaceSettings.toasts.saveError.description': 'Try again.',
  'workspaceSettings.evidenceSearch.title': 'Evidence search connector',
  'workspaceSettings.evidenceSearch.description': 'Choose the global evidence search connector.',
  'workspaceSettings.evidenceSearch.label': 'Connector',
  'workspaceSettings.evidenceSearch.none': 'No connector selected',
  'workspaceSettings.evidenceSearch.toasts.saved.title': 'Evidence search connector updated',
  'workspaceSettings.evidenceSearch.toasts.saved.description': 'The connector was updated.',
  'workspaceSettings.evidenceSearch.toasts.saveError.title': 'Evidence search connector was not updated',
  'workspaceSettings.evidenceSearch.toasts.saveError.description': 'Try again.',
};

const translateMock = vi.hoisted(() => (
  (key: string, params?: Record<string, string | number>) => {
    const translated = TRANSLATIONS[key] ?? key;
    if (!params) return translated;
    return translated.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(params[name] ?? ''));
  }
));

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('@/modules/workspace/api', () => ({
  getWorkspaceUploadSettings: vi.fn().mockResolvedValue({ allowedExtensions: [] }),
}));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return {
    ...actual,
    useModuleTranslation: () => ({
      t: translateMock,
      ready: localizationState.ready,
      language: 'en',
    }),
  };
});

vi.mock('../api', () => ({
  getAdminWorkspaceUploadSettings: vi.fn().mockResolvedValue({ allowedExtensions: [], supportedExtensions: ['.pdf', '.png'] }),
  updateAdminWorkspaceUploadSettings: vi.fn().mockResolvedValue({ allowedExtensions: [], supportedExtensions: ['.pdf', '.png'] }),
  getAdminWorkspaceEvidenceSearchSettings: vi.fn().mockResolvedValue({ connectorId: null }),
  updateAdminWorkspaceEvidenceSearchSettings: vi.fn().mockResolvedValue({ connectorId: null }),
  getAdminWorkspaceEvidenceSearchConnectors: vi.fn().mockResolvedValue([]),
}));

const mockedGet = vi.mocked(getAdminWorkspaceUploadSettings);
const mockedUpdate = vi.mocked(updateAdminWorkspaceUploadSettings);
const mockedGetEvidenceSettings = vi.mocked(getAdminWorkspaceEvidenceSearchSettings);
const mockedUpdateEvidenceSettings = vi.mocked(updateAdminWorkspaceEvidenceSearchSettings);
const mockedGetEvidenceConnectors = vi.mocked(getAdminWorkspaceEvidenceSearchConnectors);

vi.mock('@/lib/notifications', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedUpdate.mockReset();
    mockedGetEvidenceSettings.mockReset();
    mockedUpdateEvidenceSettings.mockReset();
    mockedGetEvidenceConnectors.mockReset();
    mockedGetEvidenceSettings.mockResolvedValue({ connectorId: null });
    mockedUpdateEvidenceSettings.mockResolvedValue({ connectorId: null });
    mockedGetEvidenceConnectors.mockResolvedValue([]);
    useAuthMock.mockReturnValue({ isAuthenticated: true, user: { id: 'admin' } });
    __resetAllowedUploadExtensionsCache();
  });

  it('renders the persisted extension list and saves normalized updates', async () => {
    mockedGet.mockResolvedValue({ allowedExtensions: ['.pdf', '.docx'], supportedExtensions: ['.pdf', '.docx', '.png'] });
    mockedUpdate.mockResolvedValue({ allowedExtensions: ['.pdf', '.docx', '.png'], supportedExtensions: ['.pdf', '.docx', '.png'] });

    const { user } = renderWithProviders(<WorkspaceSettingsPage />);

    expect(mockedGet).toHaveBeenCalled();
    expect((await screen.findAllByText('.pdf')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('.docx')).length).toBeGreaterThan(0);

    const input = await screen.findByLabelText(/add an extension/i);
    await user.type(input, 'PNG');

    const addButton = screen.getByRole('button', { name: /^add$/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getAllByText('.png').length).toBeGreaterThan(0);
    });

    const saveButtons = screen.getAllByRole('button', { name: /save changes/i });
    await user.click(saveButtons[0]);

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith({ allowedExtensions: ['.pdf', '.docx', '.png'] });
    });
  });

  it('rejects an invalid extension entry and shows an inline alert', async () => {
    mockedGet.mockResolvedValue({ allowedExtensions: [], supportedExtensions: ['.pdf'] });

    const { user } = renderWithProviders(<WorkspaceSettingsPage />);

    const input = await screen.findByLabelText(/add an extension/i);
    await user.type(input, 'not a valid entry');
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/invalid extension/i)).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects an unsupported extension and shows the supported list guidance', async () => {
    mockedGet.mockResolvedValue({ allowedExtensions: [], supportedExtensions: ['.pdf', '.png'] });

    const { user } = renderWithProviders(<WorkspaceSettingsPage />);

    expect(await screen.findByText('2 supported extension(s)')).toBeInTheDocument();
    expect(screen.getAllByText('.pdf').length).toBeGreaterThan(0);
    expect(screen.getAllByText('.png').length).toBeGreaterThan(0);

    const input = await screen.findByLabelText(/add an extension/i);
    await user.type(input, '.css');
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/unsupported extension/i)).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('shows every active connector and saves the selected evidence search connector', async () => {
    mockedGet.mockResolvedValue({ allowedExtensions: ['.pdf'], supportedExtensions: ['.pdf'] });
    mockedGetEvidenceConnectors.mockResolvedValue([
      { id: 'connector-search', name: 'Logical search' },
      { id: 'connector-drive', name: 'Drive search' },
    ]);
    mockedUpdateEvidenceSettings.mockResolvedValue({ connectorId: 'connector-drive' });

    const { user } = renderWithProviders(<WorkspaceSettingsPage />);

    const trigger = await screen.findByLabelText(/connector/i);
    await user.click(trigger);
    expect(await screen.findByRole('option', { name: 'No connector selected' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Logical search' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Drive search' })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Drive search' }));
    const saveButtons = screen.getAllByRole('button', { name: /^save changes$/i });
    await user.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => {
      expect(mockedUpdateEvidenceSettings).toHaveBeenCalledWith({ connectorId: 'connector-drive' });
    });
  });
});
