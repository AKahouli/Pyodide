import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  appBuilder: true,
  worky: true,
  agents: true,
}));

const storeFns = vi.hoisted(() => ({
  fetchConversations: vi.fn(),
  conversationsHasMore: false,
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
const v2PointersState = vi.hoisted(() => ({ items: [], fetch: vi.fn(), rename: vi.fn(), remove: vi.fn(), loading: false, nextCursor: null as string | null }));
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
vi.mock('@/modules/workspace', () => ({ WorkspaceButton: ({ label }: { label?: string }) => <button data-sidebar='menu-button' aria-label={label} onClick={() => navigateMock('/workspace')}>workspace-btn</button> }));
vi.mock('@/modules/semantic-model/components/SemanticModelButton', () => ({ SemanticModelButton: ({ label }: { label?: string }) => <button data-sidebar='menu-button' aria-label={label} onClick={() => navigateMock('/semantic-models')}>semantic-model-btn</button> }));
vi.mock('@/modules/playbook/components/PlaybookButton', () => ({ PlaybookButton: () => <div>playbook-btn</div> }));
vi.mock('@/modules/governance', () => ({ GovernanceButton: () => <div>governance-btn</div> }));
vi.mock('@/modules/worky/components/WorkyButton', () => ({ WorkyButton: () => <div>worky-btn</div> }));
vi.mock('@/modules/app-builder', () => ({ AppBuilderButton: () => <div>app-builder-btn</div> }));
vi.mock('@/modules/admin/constants', async original => ({ ...await original<typeof import('@/modules/admin/constants')>(),
  DEFAULT_FEATURE_VISIBILITY: { conversation: true, workspace: true, semanticModel: true, playbook: true, governance: true, appMarketplace: true, worky: true, agents: true },
}));
vi.mock('@/modules/admin/api', () => ({ getFeatureVisibility: vi.fn(async () => ({ ...featureVisibility })) }));
vi.mock('@/modules/admin/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/admin/hooks')>();
  const { DEFAULT_NAVIGATION_SETTINGS } = await import('@/modules/admin/navigation');
  return {
    ...actual,
    useNavigationSettings: () => DEFAULT_NAVIGATION_SETTINGS,
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
  useConversationV2PointersStore: (selector: (state: typeof v2PointersState) => unknown) => selector(v2PointersState),
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
    storeFns.conversationsHasMore = false;
    storeFns.fetchConversations.mockReset();
    Object.assign(v2PointersState, { loading: false, nextCursor: null });
    convoState.conversations = defaultConversations;
    storeFns.currentConversationId = 'c1';
    permissionState.governance = true;
    permissionState.semanticModels = true;
    Object.assign(featureVisibility, { conversation: true, workspace: true, playbook: true, governance: true, appBuilder: true, worky: true, agents: true });
    visibilityPermissionState.deniedFeatures.clear();
    visibilityPermissionState.deniedMenus.clear();
    Object.assign(featureVisibility, { conversation: true, workspace: true, playbook: true, governance: true, appMarketplace: true, worky: true, agents: true });
  });

  afterEach(() => {
    convoState.conversations = defaultConversations;
  });

  it('renders the target information architecture', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Knowledge' }));
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

  it('opens permitted destinations hidden from the sidebar in the launcher', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'launcher.label' }));
    expect(await screen.findByRole('button', { name: 'Teams' })).toBeInTheDocument();
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

  it('shows all loaded chats in the scrolling middle and anchors All chats in the footer', () => {
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

    expect(screen.getAllByText(/^conversation-c\d+$/)).toHaveLength(30);
    const allChatsLink = screen.getByRole('link', { name: /recentChats\.allChats/ });
    const history = screen.getByRole('button', { name: 'History' }).closest<HTMLElement>('[data-slot="collapsible"]');
    expect(allChatsLink).toHaveAttribute('href', '/chats');
    expect(container.querySelector('nav')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', 'overflow-x-hidden');
    expect(container.querySelector('nav')).toContainElement(history);
    expect(history?.querySelector('[data-slot="collapsible-content"]')).not.toHaveClass('overflow-y-auto');
    expect(allChatsLink.closest('[data-sidebar="footer"]')).toBeInTheDocument();
    expect(screen.queryByText('recentChats.today')).not.toBeInTheDocument();
    expect(screen.queryByText('recentChats.older')).not.toBeInTheDocument();
  });

  it('appends history near the bottom and prevents duplicate requests', async () => {
    storeFns.conversationsHasMore = true;
    v2PointersState.nextCursor = 'next-v2';
    const view = <MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>;
    const { container } = render(view);
    const nav = container.querySelector('nav')!;
    Object.defineProperties(nav, { scrollHeight: { value: 1000 }, clientHeight: { value: 400 }, scrollTop: { value: 0, writable: true } });
    storeFns.fetchConversations.mockClear();
    v2PointersState.fetch.mockClear();
    fireEvent.scroll(nav);
    expect(storeFns.fetchConversations).not.toHaveBeenCalled();
    let finish!: () => void;
    storeFns.fetchConversations.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    nav.scrollTop = 500;
    fireEvent.scroll(nav);
    fireEvent.scroll(nav);
    expect(storeFns.fetchConversations).toHaveBeenCalledTimes(1);
    expect(storeFns.fetchConversations).toHaveBeenCalledWith({ limit: 25 });
    expect(v2PointersState.fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('does not load another page after both histories are exhausted', () => {
    const { container } = render(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
    storeFns.fetchConversations.mockClear();
    v2PointersState.fetch.mockClear();
    fireEvent.scroll(container.querySelector('nav')!);
    expect(storeFns.fetchConversations).not.toHaveBeenCalled();
    expect(v2PointersState.fetch).not.toHaveBeenCalled();
  });

  it('restores older pinned rows before loaded history without duplicating loaded pins', () => {
    localStorage.setItem('sidebar:pins:u1', JSON.stringify([
      { kind: 'v1', id: 'older', title: 'Old pinned chat', sortTime: 1 },
      { kind: 'v1', id: 'c2', title: 'Second', sortTime: 2 },
    ]));
    render(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
    expect(screen.getAllByText(/^conversation-/).map((node) => node.textContent)).toEqual([
      'conversation-older', 'conversation-c2', 'conversation-c1',
    ]);
    expect(screen.getByText('recentChats.pinned')).toBeInTheDocument();
  });

  it('does not fetch history while loading or when the history section is closed', async () => {
    storeFns.conversationsHasMore = true;
    convoState.loading = true;
    const { container, rerender } = render(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
    const nav = container.querySelector('nav')!;
    storeFns.fetchConversations.mockClear();
    fireEvent.scroll(nav);
    expect(storeFns.fetchConversations).not.toHaveBeenCalled();
    convoState.loading = false;
    rerender(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.scroll(nav);
    expect(storeFns.fetchConversations).not.toHaveBeenCalled();
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
      appBuilder: false,
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
    expect(screen.queryByText('governance-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('app-builder-btn')).not.toBeInTheDocument();
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

  it('keeps the collapsed rail closed when clicking its background', () => {
    autoCollapseState.state = 'collapsed';
    const { container } = render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(container.querySelector('[data-sidebar="content"]')).not.toHaveClass('[&_[data-slot=collapsible-content]]:hidden');
    expect(container.querySelector('[data-sidebar="footer"]')?.firstElementChild).toHaveClass('flex-col');

    fireEvent.click(screen.getByText('Build'));

    expect(autoCollapseState.setOpen).not.toHaveBeenCalled();
  });

  it('opens a collapsed group flyout and navigates only to the selected destination', async () => {
    autoCollapseState.state = 'collapsed';
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Knowledge' }));
    expect(screen.getByRole('dialog', { name: 'Knowledge' })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(autoCollapseState.setOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Business models' }));
    expect(navigateMock).toHaveBeenCalledWith('/semantic-models');
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/chats');
  });

  it('offers only permitted destinations in the collapsed group flyout', async () => {
    autoCollapseState.state = 'collapsed';
    visibilityPermissionState.deniedFeatures.add('workspace');
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Knowledge' }));
    expect(screen.queryByRole('button', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Business models' })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('keeps disclosure icons as toggles while expanded', async () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Knowledge' }));

    expect(navigateMock).not.toHaveBeenCalled();
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

  it('starts menu folders collapsed and keeps them openable', async () => {
    localStorage.setItem('sidebar:knowledgeOpen', 'true');
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
    // Projects remain independent from managed navigation folders.
    expect(screen.getByText('projects-section')).toBeInTheDocument();
  });

  it('opens and highlights the ancestor of the current destination', () => {
    render(<MemoryRouter initialEntries={['/semantic-models/model-1']}><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
    const knowledge = screen.getByRole('button', { name: 'Knowledge' });
    expect(knowledge).toHaveAttribute('aria-expanded', 'true');
    expect(knowledge).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('semantic-model-btn')).toBeInTheDocument();
  });

  it('allows the current folder to be manually collapsed', async () => {
    render(<MemoryRouter initialEntries={['/semantic-models']}><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
    const knowledge = screen.getByRole('button', { name: 'Knowledge' });
    await userEvent.click(knowledge);
    expect(knowledge).toHaveAttribute('aria-expanded', 'false');
    expect(knowledge).toHaveAttribute('data-active', 'true');
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

  it('includes permitted menu destinations hidden from the sidebar in global search', async () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'search.label' }));
    expect(screen.getByRole('button', { name: 'Teams' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'App marketplace' })).toBeInTheDocument();
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
