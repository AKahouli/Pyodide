import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';

const navigateMock = vi.hoisted(() => vi.fn());
const featureVisibility = vi.hoisted(() => ({
  conversation: true,
  workspace: true,
  semanticModel: true,
  playbook: true,
  governance: true,
  appMarketplace: true,
  worky: true,
  agents: true,
}));

const storeFns = vi.hoisted(() => ({
  fetchConversations: vi.fn(),
  deleteConversation: vi.fn(async () => undefined),
  updateConversation: vi.fn(async () => undefined),
  currentConversationId: 'c1',
  streamingStateCache: new Map(),
  isStreaming: false,
  streamingConversationId: null as string | null,
  isAwaitingFirstChunk: false,
  awaitingConversationId: null as string | null,
}));

const convoState = vi.hoisted(() => ({
  conversations: [
    { id: 'c1', title: 'First', updatedAt: new Date().toISOString() },
    { id: 'c2', title: 'Second', updatedAt: new Date().toISOString() },
  ],
  loading: false,
}));
const defaultConversations = vi.hoisted(() => [
  { id: 'c1', title: 'First', updatedAt: '2026-09-13T10:00:00.000Z' },
  { id: 'c2', title: 'Second', updatedAt: '2026-09-13T09:00:00.000Z' },
]);

const autoCollapseState = vi.hoisted(() => ({
  isMobile: false,
  state: 'expanded' as 'expanded' | 'collapsed',
  setOpen: vi.fn(),
  toggleSidebar: vi.fn(),
}));

const permissionState = vi.hoisted(() => ({ governance: true, semanticModels: true }));
const visibilityPermissionState = vi.hoisted(() => ({
  deniedFeatures: new Set<string>(),
  deniedMenus: new Set<string>(),
}));
const projectState = vi.hoisted(() => ({
  projects: [{ id: 'p1', name: 'Project Alpha' }],
  createProject: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/components/ui/command', () => ({
  CommandDialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid='global-search-dialog'>{children}</div> : null,
  CommandInput: (props: { placeholder?: string }) => <input data-testid='global-search-input' {...props} />,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: () => null,
  CommandGroup: ({ children, heading }: { children: ReactNode; heading?: string }) => (
    <div><div>{heading}</div>{children}</div>
  ),
  CommandItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type='button' onClick={onSelect}>{children}</button>
  ),
}));

vi.mock('@/components/AppBrandLogo', () => ({ AppBrandLogo: () => <div>logo</div> }));
vi.mock('@/components/ui/profile-menu', () => ({ ProfileMenu: () => <div>profile-menu</div> }));
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => <div>mode-toggle</div> }));
vi.mock('@/modules/workspace', () => ({ WorkspaceButton: () => <div>workspace-btn</div> }));
vi.mock('@/modules/semantic-model/components/SemanticModelButton', () => ({ SemanticModelButton: () => <div>semantic-model-btn</div> }));
vi.mock('@/modules/playbook/components/PlaybookButton', () => ({ PlaybookButton: () => <div>playbook-btn</div> }));
vi.mock('@/modules/governance', () => ({ GovernanceButton: () => <div>governance-btn</div> }));
vi.mock('@/modules/worky/components/WorkyButton', () => ({ WorkyButton: () => <div>worky-btn</div> }));
vi.mock('@/modules/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/admin')>();
  return {
    ...actual,
    AdminButton: () => <div>admin-btn</div>,
    DEFAULT_FEATURE_VISIBILITY: { conversation: true, workspace: true, semanticModel: true, playbook: true, governance: true, appMarketplace: true, worky: true, agents: true },
    getFeatureVisibility: vi.fn(async () => ({ ...featureVisibility })),
    useNavigationSettings: () => actual.DEFAULT_NAVIGATION_SETTINGS,
  };
});
vi.mock('@/modules/admin/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasAnyPermission: (permissions: string[]) => permissions.some((permission) => permission.startsWith('governance'))
      ? permissionState.governance
      : permissionState.semanticModels,
    canUseFeature: (feature: string) => !visibilityPermissionState.deniedFeatures.has(feature),
    canSeeMenu: (menu: string) => !visibilityPermissionState.deniedMenus.has(menu),
  }),
}));
vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

vi.mock('@/modules/conversation/components/ShareDialog', () => ({
  ShareDialog: ({ open, conversationId }: { open: boolean; conversationId: string }) =>
    open ? <div>share-dialog-{conversationId}</div> : null,
}));

vi.mock('../hooks/useAutoCollapse', () => ({ useAutoCollapse: () => autoCollapseState }));

vi.mock('@/modules/conversation/store', () => ({
  useConversationStore: (selector: (state: typeof storeFns) => unknown) => selector(storeFns),
  useHistoryConversations: () => convoState.conversations,
  useConversationsLoading: () => convoState.loading,
}));

vi.mock('@/modules/conversation-v2/store', () => ({
  useConversationV2PointersStore: (selector: (state: { items: never[]; fetch: () => void; rename: () => void; remove: () => void }) => unknown) => selector({ items: [], fetch: vi.fn(), rename: vi.fn(), remove: vi.fn() }),
  useConversationV2Store: (
    selector: (state: { sessionId: null; streaming: boolean; streamingStateCache: Map<string, { streaming: boolean }> }) => unknown,
  ) => selector({ sessionId: null, streaming: false, streamingStateCache: new Map() }),
}));

vi.mock('@/modules/project/store', () => ({
  useProjects: () => projectState.projects,
  useProjectStore: (selector: (state: typeof projectState) => unknown) => selector(projectState),
}));

vi.mock('./ProjectsSection', () => ({ ProjectsSection: () => <div>projects-section</div> }));

vi.mock('./ConversationItem', () => ({
  ConversationItem: ({ id, onDelete, onRename, onShare }: { id: string; onDelete: () => Promise<void>; onRename: (v: string) => Promise<void>; onShare: () => void }) => (
    <div>
      <span>conversation-{id}</span>
      <button type='button' onClick={() => onRename('Renamed')}>rename-{id}</button>
      <button type='button' onClick={onDelete}>delete-{id}</button>
      <button type='button' onClick={onShare}>share-{id}</button>
    </div>
  ),
}));

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    autoCollapseState.isMobile = false;
    autoCollapseState.state = 'expanded';
    convoState.loading = false;
    convoState.conversations = defaultConversations;
    storeFns.currentConversationId = 'c1';
    permissionState.governance = true;
    permissionState.semanticModels = true;
    visibilityPermissionState.deniedFeatures.clear();
    visibilityPermissionState.deniedMenus.clear();
    Object.assign(featureVisibility, { conversation: true, workspace: true, playbook: true, governance: true, appMarketplace: true, worky: true, agents: true });
  });

  afterEach(() => {
    convoState.conversations = defaultConversations;
  });

  it('renders the target information architecture', async () => {
    localStorage.setItem('sidebar:knowledgeOpen', 'true');
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    // Header
    expect(screen.getByRole('link', { name: 'actions.home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'search.label' })).toBeInTheDocument();

    // WORK group
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/platform');
    expect(screen.getByText('projects-section')).toBeInTheDocument();

    // BUILD group
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('workspace-btn')).toBeInTheDocument();
    expect(screen.getByText('semantic-model-btn')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agents & teams' })).toHaveAttribute('href', '/agents');
    expect(screen.getByText('playbook-btn')).toBeInTheDocument();
    expect(screen.getByText('worky-btn')).toBeInTheDocument();
    // Integrations (connected apps + app marketplace) mirrors the menu tree's automate branch.
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute('href', '/apps');

    // Managed governance destinations
    expect(screen.getByRole('link', { name: 'Governance' })).toHaveAttribute('href', '/governance');
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/admin');
    expect(screen.getByText('profile-menu')).toBeInTheDocument();

    // Recent chats is the only list region
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('conversation-c1')).toBeInTheDocument();
    expect(screen.getByText('conversation-c2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /recentChats\.allChats/ })).toHaveAttribute('href', '/chats');
    expect(screen.queryByText('history.showMore')).not.toBeInTheDocument();
  });

  it('fetches conversations on mount', () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(storeFns.fetchConversations).toHaveBeenCalledWith({ reset: true, limit: 25 });
  });

  it('caps recent chats at 25 rows and links to All chats', () => {
    convoState.conversations = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      title: `Chat ${i}`,
      updatedAt: new Date(Date.now() - i * 60_000).toISOString(),
    }));
    const { container } = render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.getAllByText(/^conversation-c\d+$/)).toHaveLength(25);
    const allChatsLink = screen.getByRole('link', { name: /recentChats\.allChats/ });
    const history = screen.getByRole('button', { name: 'History' }).closest<HTMLElement>('[data-slot="collapsible"]');
    expect(allChatsLink).toHaveAttribute('href', '/chats');
    expect(container.querySelector('nav')).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden');
    expect(container.querySelector('nav')?.firstElementChild).toHaveClass('max-h-[65%]', 'overflow-y-auto');
    expect(container.querySelector('nav')?.firstElementChild).not.toContainElement(history);
    expect(history).toHaveClass('min-h-0', 'flex-1', 'flex-col');
    expect(history?.querySelector('[data-slot="collapsible-content"]')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    expect(allChatsLink.closest('[data-sidebar="menu"]')).toHaveClass('sticky', 'bottom-0');
  });

  it('does not remap the agents target when its permission is denied', () => {
    visibilityPermissionState.deniedMenus.add('agents');
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Agents & teams' })).not.toBeInTheDocument();
  });

  it('does not remap the connected apps target when its permission is denied', () => {
    visibilityPermissionState.deniedMenus.add('connectedApps');
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Integrations' })).not.toBeInTheDocument();
  });

  it('hides the recent chats region when the history menu is denied', () => {
    visibilityPermissionState.deniedMenus.add('history');
    const { container } = render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByText('History')).not.toBeInTheDocument();
    expect(container.querySelector('.max-h-\\[65\\%\\]')).not.toBeInTheDocument();
    expect(container.querySelector('nav')).toHaveClass('flex-1', 'overflow-y-auto');
    expect(screen.queryByText('conversation-c1')).not.toBeInTheDocument();
  });

  it('hides gated features but keeps recent chats', async () => {
    Object.assign(featureVisibility, {
      conversation: false,
      workspace: false,
      playbook: false,
      governance: false,
      appMarketplace: false,
      worky: false,
      agents: false,
    });
    visibilityPermissionState.deniedMenus.add('agents');
    visibilityPermissionState.deniedMenus.add('teams');
    visibilityPermissionState.deniedMenus.add('groups');
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument());
    expect(screen.queryByText('workspace-btn')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agents & teams' })).not.toBeInTheDocument();
    expect(screen.queryByText('playbook-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('worky-btn')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Governance' })).not.toBeInTheDocument();
    expect(screen.getByText('conversation-c1')).toBeInTheDocument();
  });

  it('supports row actions from the recent chats region', async () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'rename-c1' }));
    expect(storeFns.updateConversation).toHaveBeenCalledWith('c1', { title: 'Renamed' });

    await userEvent.click(screen.getByRole('button', { name: 'delete-c1' }));
    await waitFor(() => expect(storeFns.deleteConversation).toHaveBeenCalledWith('c1'));
    expect(navigateMock).toHaveBeenCalledWith('/');

    await userEvent.click(screen.getByRole('button', { name: 'share-c2' }));
    expect(screen.getByText('share-dialog-c2')).toBeInTheDocument();
  });

  it('expands the rail and navigates home when starting a chat from collapsed mode', async () => {
    autoCollapseState.state = 'collapsed';
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));

    expect(navigateMock).toHaveBeenCalledWith('/');
    expect(autoCollapseState.toggleSidebar).toHaveBeenCalled();
  });

  it('re-opens the rail from a click anywhere on the collapsed rail', () => {
    autoCollapseState.state = 'collapsed';
    const { container } = render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(container.querySelector('[data-sidebar="content"]')).toHaveClass('[&_[data-slot=collapsible-content]]:hidden');
    expect(container.querySelector('[data-sidebar="footer"]')?.firstElementChild).toHaveClass('flex-col');

    fireEvent.click(screen.getByText('Build'));

    expect(autoCollapseState.setOpen).toHaveBeenCalledWith(true);
  });

  it('ignores rail clicks while expanded', () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('Build'));

    expect(autoCollapseState.setOpen).not.toHaveBeenCalled();
  });

  it('never expands from a rail click on mobile', () => {
    autoCollapseState.isMobile = true;
    autoCollapseState.state = 'collapsed';
    const { container } = render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('New chat'));

    expect(autoCollapseState.setOpen).not.toHaveBeenCalled();
    expect(container.querySelector('.max-h-\\[65\\%\\]')).not.toBeInTheDocument();
    expect(container.querySelector('nav')).toHaveClass('overflow-y-auto');
  });

  it('keeps Knowledge and Projects independently openable (multi-open)', async () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    const knowledge = screen.getByRole('button', { name: 'Knowledge' });
    expect(knowledge).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('workspace-btn')).not.toBeInTheDocument();

    await userEvent.click(knowledge);
    expect(knowledge).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('workspace-btn')).toBeInTheDocument();
    // Projects section is still rendered alongside — no single-open coupling.
    expect(screen.getByText('projects-section')).toBeInTheDocument();
    expect(localStorage.getItem('sidebar:knowledgeOpen')).toBe('true');
  });

  it('opens the global search palette from the trigger', async () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'search.label' }));
    expect(screen.getByTestId('global-search-dialog')).toBeInTheDocument();
  });

  it('hides chats from global search when History is denied', async () => {
    visibilityPermissionState.deniedMenus.add('history');
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'search.label' }));
    expect(screen.queryByText('First')).not.toBeInTheDocument();
  });

  it('hides projects from global search when Projects is denied', async () => {
    visibilityPermissionState.deniedMenus.add('projects');
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'search.label' }));
    expect(screen.queryByText('Project Alpha')).not.toBeInTheDocument();
  });

  it('opens the global search palette via Ctrl+K', () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('global-search-dialog')).toBeInTheDocument();
  });
});
