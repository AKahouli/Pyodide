import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { makeAuthState } from '../test-utils';
import { RootGuard } from './RootGuard';

const useAuthMock = vi.hoisted(() => vi.fn());
const fetchModelsMock = vi.hoisted(() => vi.fn());
const getFeatureVisibilityMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('@/modules/models', () => ({
  useModelsStore: (selector: (state: { fetchModels: () => void }) => unknown) => selector({ fetchModels: fetchModelsMock }),
}));
vi.mock('@/modules/conversation/hooks/useConversationStream', () => ({
  useConversationStream: vi.fn(),
}));
vi.mock('@/modules/playbook/services/playbookStreamService', () => ({
  usePlaybookStreamGlobal: vi.fn(),
}));
vi.mock('@/modules/sidebar', () => ({ AppSidebar: () => <div data-testid='app-sidebar' /> }));
vi.mock('@/modules/conversation', () => ({ NewConversationPage: () => <div>new conversation page</div> }));
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div data-testid='sidebar-provider'>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTriggerMobile: () => <button type='button'>trigger</button>,
}));
vi.mock('@/modules/auth/components/LandingPage', () => ({ LandingPage: () => <div>landing page</div> }));
vi.mock('@/modules/conversation/effects/stars-background', () => ({
  StarsBackground: () => <div data-testid='stars-bg' />,
}));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: (key: string) => key, ready: true, language: 'en' }) };
});
vi.mock('@/modules/admin', () => ({
  DEFAULT_FEATURE_VISIBILITY: { platformCopilot: false },
  getFeatureVisibility: getFeatureVisibilityMock,
}));
vi.mock('@/modules/platform-copilot', () => ({
  PlatformCopilotMascot: () => <div>platform copilot mascot</div>,
}));

describe('RootGuard', () => {
  const renderWithRouter = (ui: ReactNode, initialEntries: string[] = ['/']) =>
    render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    getFeatureVisibilityMock.mockResolvedValue({ platformCopilot: false });
  });

  it('renders landing page for guests', () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: false }));

    renderWithRouter(<RootGuard />);

    expect(screen.getByText('landing page')).toBeInTheDocument();
    expect(fetchModelsMock).not.toHaveBeenCalled();
  });

  it('redirects to profile completion when required', async () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: true, requiresProfileCompletion: true }));

    renderWithRouter(
      <Routes>
        <Route path='/' element={<RootGuard />} />
        <Route path='/complete-profile' element={<div>complete profile page</div>} />
      </Routes>,
    );

    await waitFor(() => expect(screen.getByText('complete profile page')).toBeInTheDocument());
  });

  it('renders authenticated layout and triggers model fetch', async () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: true }));

    renderWithRouter(
      <Routes>
        <Route path='/' element={<RootGuard />}>
          <Route path='conversation/:id' element={<div>conversation outlet</div>} />
        </Route>
      </Routes>,
    );

    expect(screen.getByTestId('sidebar-provider')).toBeInTheDocument();
    expect(screen.getByText('new conversation page')).toBeInTheDocument();
    await waitFor(() => expect(fetchModelsMock).toHaveBeenCalledTimes(1));
  });

  it('renders authenticated child routes without replacing the new conversation homepage', () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: true }));

    renderWithRouter(
      <Routes>
        <Route path='/' element={<RootGuard />}>
          <Route path='platform' element={<div>platform overview page</div>} />
        </Route>
      </Routes>,
      ['/platform'],
    );

    expect(screen.getByText('platform overview page')).toBeInTheDocument();
    expect(screen.queryByText('new conversation page')).not.toBeInTheDocument();
  });

  it('renders Platform Copilot only when persisted feature visibility enables it', async () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: true }));
    getFeatureVisibilityMock.mockResolvedValue({ platformCopilot: true });

    renderWithRouter(<RootGuard />);

    await waitFor(() => expect(screen.getByText('platform copilot mascot')).toBeInTheDocument());
  });

  it('hides Platform Copilot inside a Worky stream without hiding it on other Worky routes', async () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: true }));
    getFeatureVisibilityMock.mockResolvedValue({ platformCopilot: true });

    const { unmount } = renderWithRouter(
      <Routes>
        <Route path='/' element={<RootGuard />}>
          <Route path='worky/:streamId' element={<div>worky stream</div>} />
        </Route>
      </Routes>,
      ['/worky/stream-1/'],
    );

    await waitFor(() => expect(getFeatureVisibilityMock).toHaveBeenCalled());
    expect(screen.queryByText('platform copilot mascot')).not.toBeInTheDocument();
    unmount();

    renderWithRouter(
      <Routes>
        <Route path='/' element={<RootGuard />}>
          <Route path='worky/:streamId/report' element={<div>worky report</div>} />
        </Route>
      </Routes>,
      ['/worky/stream-1/report'],
    );

    await waitFor(() => expect(screen.getByText('platform copilot mascot')).toBeInTheDocument());
  });

  it('keeps Platform Copilot hidden when feature visibility cannot be loaded', async () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: true }));
    getFeatureVisibilityMock.mockRejectedValue(new Error('unavailable'));

    renderWithRouter(<RootGuard />);

    await waitFor(() => expect(getFeatureVisibilityMock).toHaveBeenCalled());
    expect(screen.queryByText('platform copilot mascot')).not.toBeInTheDocument();
  });

  it('shows a dedicated pending-approval page and skips the app shell for inactive users', async () => {
    const logout = vi.fn();
    useAuthMock.mockReturnValue(
      makeAuthState({
        isAuthenticated: true,
        logout,
        user: { status: 'inactive' } as never,
      }),
    );

    renderWithRouter(<RootGuard />);

    expect(screen.getByRole('status')).toHaveTextContent('pendingApproval.message');
    expect(screen.getByRole('heading')).toHaveTextContent('pendingApproval.welcomePrefix');
    expect(screen.getByRole('button', { name: 'pendingApproval.logout' })).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-provider')).not.toBeInTheDocument();
    expect(screen.queryByText('new conversation page')).not.toBeInTheDocument();
    expect(fetchModelsMock).not.toHaveBeenCalled();
    expect(getFeatureVisibilityMock).not.toHaveBeenCalled();
  });

  it('does not show the pending-approval page on the profile-completion redirect', async () => {
    useAuthMock.mockReturnValue(
      makeAuthState({
        isAuthenticated: true,
        requiresProfileCompletion: true,
        user: { status: 'inactive' } as never,
      }),
    );

    renderWithRouter(
      <Routes>
        <Route path='/' element={<RootGuard />} />
        <Route path='/complete-profile' element={<div>complete profile page</div>} />
      </Routes>,
    );

    await waitFor(() => expect(screen.getByText('complete profile page')).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
