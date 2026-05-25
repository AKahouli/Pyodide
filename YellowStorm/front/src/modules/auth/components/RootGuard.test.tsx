import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { makeAuthState } from '../test-utils';
import { RootGuard } from './RootGuard';

const useAuthMock = vi.hoisted(() => vi.fn());
const fetchModelsMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('@/modules/models', () => ({
  useModelsStore: (selector: (state: { fetchModels: () => void }) => unknown) => selector({ fetchModels: fetchModelsMock }),
}));
vi.mock('@/modules/conversation/hooks/useConversationStream', () => ({
  useConversationStream: vi.fn(),
}));
vi.mock('@/modules/sidebar', () => ({ AppSidebar: () => <div data-testid='app-sidebar' /> }));
vi.mock('@/modules/conversation', () => ({ NewConversationPage: () => <div>new conversation page</div> }));
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div data-testid='sidebar-provider'>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTriggerMobile: () => <button type='button'>trigger</button>,
}));
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => <div>mode toggle</div> }));
vi.mock('@/modules/auth/components/LandingPage', () => ({ LandingPage: () => <div>landing page</div> }));

describe('RootGuard', () => {
  const renderWithRouter = (ui: ReactNode, initialEntries: string[] = ['/']) =>
    render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
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
});
