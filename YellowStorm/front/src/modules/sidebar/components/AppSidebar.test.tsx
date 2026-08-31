import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';

const navigateMock = vi.hoisted(() => vi.fn());
const featureVisibility = vi.hoisted(() => ({
  conversation: true,
  workspace: true,
  playbook: true,
  governance: true,
  appBuilder: true,
  worky: true,
  agents: true,
}));

const storeFns = vi.hoisted(() => ({
  fetchConversations: vi.fn(),
  deleteConversation: vi.fn(async () => undefined),
  updateConversation: vi.fn(async () => undefined),
  currentConversationId: 'c1',
}));

const convoState = vi.hoisted(() => ({
  conversations: [{ id: 'c1', title: 'First' }, { id: 'c2', title: 'Second' }],
  loading: false,
  hasMore: true,
  historyOpen: true,
}));

const autoCollapseState = vi.hoisted(() => ({
  state: 'expanded' as 'expanded' | 'collapsed',
  toggleSidebar: vi.fn(),
}));

const toggleHistoryPanelMock = vi.hoisted(() => vi.fn());
const permissionState = vi.hoisted(() => ({ governance: true, semanticModels: true }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, onClick, disabled, asChild }: { children: ReactNode; onClick?: () => void; disabled?: boolean; asChild?: boolean }) =>
    asChild ? children : <button type='button' disabled={disabled} onClick={onClick}>{children}</button>,
  SidebarMenuSkeleton: ({ index }: { index: number }) => <div>skel-{index}</div>,
  SidebarFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => <button type='button'>trigger</button>,
  SidebarRail: () => null,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button type='button' onClick={onClick}>{children}</button>,
}));

vi.mock('@/components/ui/collapsible', async () => {
  const { cloneElement, createContext, isValidElement, useContext } = await vi.importActual<typeof import('react')>('react');
  const CollapsibleContext = createContext<{ open: boolean; onOpenChange: (open: boolean) => void } | null>(null);

  return {
    Collapsible: ({ children, open, onOpenChange }: { children: ReactNode; open?: boolean; onOpenChange: (open: boolean) => void }) => (
      <CollapsibleContext.Provider value={{ open: Boolean(open), onOpenChange }}>
        <div data-open={String(Boolean(open))}>{children}</div>
      </CollapsibleContext.Provider>
    ),
    CollapsibleTrigger: ({ children }: { children: ReactNode }) => {
      const context = useContext(CollapsibleContext);
      if (!context || !isValidElement<{ onClick?: () => void }>(children)) return children;
      return cloneElement(children, { onClick: () => context.onOpenChange(!context.open) });
    },
    CollapsibleContent: ({ children }: { children: ReactNode }) => {
      const context = useContext(CollapsibleContext);
      return context?.open ? <div>{children}</div> : null;
    },
  };
});

vi.mock('@/components/icons', () => ({ Icons: { YellowMind: () => <div>logo</div> }, AppLogo: () => <div>logo</div> }));
vi.mock('@/components/ui/profile-menu', () => ({ ProfileMenu: () => <div>profile-menu</div> }));
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => <div>mode-toggle</div> }));
vi.mock('@/modules/workspace', () => ({ WorkspaceButton: () => <div>workspace-btn</div> }));
vi.mock('@/modules/semantic-model/components/SemanticModelButton', () => ({ SemanticModelButton: () => <div>semantic-model-btn</div> }));
vi.mock('@/modules/agent', () => ({ AgentButton: () => <div>agent-btn</div> }));
vi.mock('@/modules/team', () => ({ TeamButton: () => <div>team-btn</div> }));
vi.mock('@/modules/groups', () => ({ GroupsButton: () => <div>groups-btn</div> }));
vi.mock('@/modules/connected-app', () => ({ ConnectedAppButton: () => <div>connected-app-btn</div> }));
vi.mock('@/modules/playbook/components/PlaybookButton', () => ({ PlaybookButton: () => <div>playbook-btn</div> }));
vi.mock('@/modules/governance', () => ({ GovernanceButton: () => <div>governance-btn</div> }));
vi.mock('@/modules/worky/components/WorkyButton', () => ({ WorkyButton: () => <div>worky-btn</div> }));
vi.mock('@/modules/app-builder', () => ({ AppBuilderButton: () => <div>app-builder-btn</div> }));
vi.mock('@/modules/admin', () => ({
  AdminButton: () => <div>admin-btn</div>,
  DEFAULT_FEATURE_VISIBILITY: { conversation: true, workspace: true, playbook: true, governance: true, appBuilder: true, worky: true, agents: true },
  getFeatureVisibility: vi.fn(async () => ({ ...featureVisibility })),
}));
vi.mock('@/modules/admin/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasAnyPermission: (permissions: string[]) => permissions.some((permission) => permission.startsWith('governance'))
      ? permissionState.governance
      : permissionState.semanticModels,
  }),
}));
vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

vi.mock('@/modules/conversation/components/ShareDialog', () => ({
  ShareDialog: ({ open, conversationId }: { open: boolean; conversationId: string }) =>
    open ? <div>share-dialog-{conversationId}</div> : null,
}));

vi.mock('../hooks/useAutoCollapse', () => ({ useAutoCollapse: () => autoCollapseState }));

vi.mock('@/modules/conversation/store', () => ({
  DEFAULT_CONVERSATIONS_LIMIT: 20,
  useConversationStore: (selector: (state: typeof storeFns) => unknown) => selector(storeFns),
  useHistoryConversations: () => convoState.conversations,
  useConversationsLoading: () => convoState.loading,
  useConversationsHasMore: () => convoState.hasMore,
  useHistoryPanelOpen: () => convoState.historyOpen,
  useToggleHistoryPanel: () => toggleHistoryPanelMock,
}));

vi.mock('@/modules/conversation-v2/store', () => ({
  useConversationV2PointersStore: (selector: (state: { items: never[]; fetch: () => void; rename: () => void; remove: () => void }) => unknown) => selector({ items: [], fetch: vi.fn(), rename: vi.fn(), remove: vi.fn() }),
  useConversationV2Store: (selector: (state: { sessionId: null }) => unknown) => selector({ sessionId: null }),
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
    autoCollapseState.state = 'expanded';
    convoState.loading = false;
    convoState.hasMore = true;
    convoState.historyOpen = true;
    storeFns.currentConversationId = 'c1';
    permissionState.governance = true;
    permissionState.semanticModels = true;
    Object.assign(featureVisibility, { conversation: true, workspace: true, playbook: true, governance: true, appBuilder: true, worky: true, agents: true });
  });

  it('hides disabled feature buttons but keeps conversation history', async () => {
    Object.assign(featureVisibility, {
      conversation: false,
      workspace: false,
      playbook: false,
      governance: false,
      appBuilder: false,
      worky: false,
      agents: false,
    });
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByRole('button', { name: 'actions.newChat.label' })).not.toBeInTheDocument());
    expect(screen.queryByText('workspace-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('agent-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('playbook-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('governance-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('app-builder-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('worky-btn')).not.toBeInTheDocument();
    expect(screen.getByText('history.label')).toBeInTheDocument();
    expect(screen.getByText('conversation-c1')).toBeInTheDocument();
  });

  it('fetches conversations on mount and supports key actions', async () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(storeFns.fetchConversations).toHaveBeenCalledWith({ reset: true, limit: 20 });
    expect(screen.getByRole('link', { name: 'actions.home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'actions.platformOverview.label' })).toHaveAttribute('href', '/platform');
    expect(screen.getByText('groups.ask.label')).toBeInTheDocument();
    expect(screen.getByText('groups.knowledge.label')).toBeInTheDocument();
    expect(screen.getByText('groups.automate.label')).toBeInTheDocument();
    expect(screen.getByText('groups.govern.label')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'actions.newChat.label' }));
    expect(navigateMock).toHaveBeenCalledWith('/');

    await userEvent.click(screen.getByRole('button', { name: 'rename-c1' }));
    expect(storeFns.updateConversation).toHaveBeenCalledWith('c1', { title: 'Renamed' });

    await userEvent.click(screen.getByRole('button', { name: 'delete-c1' }));
    await waitFor(() => expect(storeFns.deleteConversation).toHaveBeenCalledWith('c1'));
    expect(navigateMock).toHaveBeenCalledWith('/');

    await userEvent.click(screen.getByRole('button', { name: 'share-c2' }));
    expect(screen.getByText('share-dialog-c2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'history.showMore' }));
    expect(storeFns.fetchConversations).toHaveBeenCalledWith({ limit: 20 });
  });

  it('expands the sidebar when an outcome group is opened from collapsed mode', async () => {
    autoCollapseState.state = 'collapsed';
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'groups.ask.label' }));
    expect(autoCollapseState.toggleSidebar).toHaveBeenCalled();
  });

  it('opens only the active outcome group automatically', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <AppSidebar />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'groups.ask.label' }).closest('[data-open]')).toHaveAttribute('data-open', 'false'));
    expect(screen.getByRole('button', { name: 'groups.knowledge.label' }).closest('[data-open]')).toHaveAttribute('data-open', 'true');
    expect(screen.getByRole('button', { name: 'groups.automate.label' }).closest('[data-open]')).toHaveAttribute('data-open', 'false');
    expect(screen.getByRole('button', { name: 'groups.govern.label' }).closest('[data-open]')).toHaveAttribute('data-open', 'false');
  });

  it('keeps top-level navigation available by opening one outcome group at a time', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppSidebar />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'groups.ask.label' }).closest('[data-open]')).toHaveAttribute('data-open', 'true'));
    await userEvent.click(screen.getByRole('button', { name: 'groups.knowledge.label' }));

    expect(screen.getByRole('button', { name: 'groups.ask.label' }).closest('[data-open]')).toHaveAttribute('data-open', 'false');
    expect(screen.getByRole('button', { name: 'groups.knowledge.label' }).closest('[data-open]')).toHaveAttribute('data-open', 'true');
    expect(screen.queryByText('conversation-c1')).not.toBeInTheDocument();
  });

  it('matches governance and semantic model sidebar visibility to permissions', async () => {
    permissionState.governance = false;
    permissionState.semanticModels = false;

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(screen.queryByText('governance-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('semantic-model-btn')).not.toBeInTheDocument();
    expect(await screen.findByText('workspace-btn')).toBeInTheDocument();
  });
});
