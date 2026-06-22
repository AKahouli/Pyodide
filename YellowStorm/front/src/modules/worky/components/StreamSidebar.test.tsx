import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { StreamSidebar } from './StreamSidebar';
import { mockApiClient, mockNavigate } from '@/test/setup';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/modules/auth';
import type { AuthContextType } from '@/modules/auth';
import { LocalizationProvider } from '@/modules/localization';
import { ThemeProvider } from '@/contexts/ThemeContext';

const sampleStream = {
  id: 'stream-1',
  ownerUserId: 'user-1',
  workspaceId: 'ws-1',
  artifactWorkspaceId: 'ws-art-1',
  managerAgentId: 'agent-1',
  title: 'My first stream',
  status: 'created',
  controlState: 'active',
  schedulerEnabled: false,
  currentPlanVersion: 0,
  executionPlanVersion: null,
  budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
  startedAt: null,
  completedAt: null,
  activeDurationMinutes: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
};

const makeClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

const authValue: AuthContextType = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 'user-1', email: 'user-1@example.com' } as AuthContextType['user'],
  requiresEmailVerification: false,
  requiresProfileCompletion: false,
  registrationEnabled: true,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
  completeProfile: vi.fn(),
  refreshUser: vi.fn(),
};

let client: QueryClient;
function TestProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LocalizationProvider>
            <ThemeProvider defaultTheme='light'>{children}</ThemeProvider>
          </LocalizationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

const renderWithQuery = () => {
  const user = userEvent.setup();
  const result = render(<StreamSidebar />, { wrapper: TestProviders });
  return { user, ...result };
};

describe('StreamSidebar', () => {
  beforeEach(() => {
    mockApiClient.get.mockReset();
    mockApiClient.post.mockReset();
    mockApiClient.delete.mockReset();
    mockNavigate.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('lists streams returned by the backend', async () => {
    mockApiClient.get.mockResolvedValue({ data: { data: [sampleStream] } });
    client = makeClient();
    const { findByText } = renderWithQuery();
    expect(await findByText('My first stream')).toBeInTheDocument();
  });

  it('creates a new stream, calls the API, and navigates to it', async () => {
    mockApiClient.get.mockResolvedValue({ data: { data: [] } });
    mockApiClient.post.mockResolvedValue({ data: { data: sampleStream } });
    client = makeClient();
    const { user, getByRole, getByPlaceholderText } = renderWithQuery();

    await user.click(getByRole('button', { name: 'sidebar.newStream' }));
    const input = getByPlaceholderText('sidebar.newStreamPlaceholder');
    await user.type(input, 'My first stream');
    await user.click(getByRole('button', { name: 'actions.create' }));

    expect(mockApiClient.post).toHaveBeenCalledWith(
      expect.stringContaining('/worky/streams'),
      { title: 'My first stream' },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/worky/stream-1');
  });

  it('does not delete a stream when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockApiClient.get.mockResolvedValue({ data: { data: [sampleStream] } });
    client = makeClient();
    const { user, findByRole } = renderWithQuery();

    await user.click(await findByRole('button', { name: 'sidebar.deleteStream' }));

    expect(window.confirm).toHaveBeenCalledWith('sidebar.deleteConfirm');
    expect(mockApiClient.delete).not.toHaveBeenCalled();
  });

  it('deletes a stream after confirmation', async () => {
    mockApiClient.get.mockResolvedValue({ data: { data: [sampleStream] } });
    mockApiClient.delete.mockResolvedValue({ data: { data: { ok: true, deletedWorkspaceId: 'ws-art-1' } } });
    client = makeClient();
    const { user, findByRole } = renderWithQuery();

    await user.click(await findByRole('button', { name: 'sidebar.deleteStream' }));

    expect(mockApiClient.delete).toHaveBeenCalledWith('/worky/streams/stream-1/delete');
  });
});
