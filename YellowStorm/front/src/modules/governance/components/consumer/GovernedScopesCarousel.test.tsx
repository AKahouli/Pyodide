import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GovernedScopesCarousel } from './GovernedScopesCarousel';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  navigate: vi.fn(),
  refetch: vi.fn(),
  scrollPrev: vi.fn(),
  scrollNext: vi.fn(),
  emblaOptions: vi.fn(),
  canScrollPrev: false,
  canScrollNext: false,
  queryResult: {
    data: [{
      scopeId: 'scope-1',
      programId: 'program-1',
      name: 'Quality assurance',
      type: 'team',
      description: 'Approved quality assistant' as string | undefined,
      deploymentId: 'deployment-1',
      publishedRevisionId: 'revision-1',
      revisionNumber: 5,
      primaryAgent: { id: 'agent-1', name: 'Internal agent', description: 'Agent description' },
      agentCount: 2,
      workspaceCount: 3,
      presentation: {},
    }],
    isLoading: false,
    isError: false,
  },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/modules/admin/featureVisibilityStore', () => ({
  useFeatureVisibilityStore: (selector: (state: { visibility: { governedScopeCarousel: boolean } }) => unknown) => selector({ visibility: { governedScopeCarousel: true } }),
}));
vi.mock('@/modules/conversation/api', () => ({ createGovernedConversation: mocks.createConversation }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn() }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/governance', () => ({ useAvailableGovernedScopes: () => ({ ...mocks.queryResult, refetch: mocks.refetch }) }));
vi.mock('embla-carousel-react', () => ({
  default: (options: unknown) => {
    mocks.emblaOptions(options);
    return [vi.fn(), {
      canScrollPrev: () => mocks.canScrollPrev,
      canScrollNext: () => mocks.canScrollNext,
      slideNodes: () => [],
      rootNode: () => null,
      slidesInView: () => [0],
      selectedScrollSnap: () => 0,
      on: vi.fn(),
      off: vi.fn(),
      scrollPrev: mocks.scrollPrev,
      scrollNext: mocks.scrollNext,
    }];
  },
}));

describe('GovernedScopesCarousel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryResult.data = [{
      scopeId: 'scope-1',
      programId: 'program-1',
      name: 'Quality assurance',
      type: 'team',
      description: 'Approved quality assistant',
      deploymentId: 'deployment-1',
      publishedRevisionId: 'revision-1',
      revisionNumber: 5,
      primaryAgent: { id: 'agent-1', name: 'Internal agent', description: 'Agent description' },
      agentCount: 2,
      workspaceCount: 3,
      presentation: {},
    }];
    mocks.queryResult.isLoading = false;
    mocks.queryResult.isError = false;
    mocks.canScrollPrev = false;
    mocks.canScrollNext = false;
  });

  it('connects the compact navigation controls to Embla', async () => {
    mocks.canScrollPrev = true;
    mocks.canScrollNext = true;
    render(<GovernedScopesCarousel />);

    const previous = await screen.findByRole('button', { name: 'carousel.previous' });
    const next = screen.getByRole('button', { name: 'carousel.next' });
    await waitFor(() => expect(previous).toBeEnabled());

    fireEvent.click(previous);
    fireEvent.click(next);
    expect(mocks.scrollPrev).toHaveBeenCalledOnce();
    expect(mocks.scrollNext).toHaveBeenCalledOnce();
  });

  it('does not replace a missing scope description with assistant copy', () => {
    mocks.queryResult.data[0].description = undefined;
    render(<GovernedScopesCarousel />);

    expect(screen.queryByText('Agent description')).not.toBeInTheDocument();
    expect(screen.queryByText('governedScopes.defaultDescription')).not.toBeInTheDocument();
  });

  it('uses the playbook carousel structure and keeps scope cards compact', () => {
    render(<GovernedScopesCarousel />);

    expect(mocks.emblaOptions).toHaveBeenCalledWith({ align: 'start', dragFree: true, containScroll: 'trimSnaps' });
    expect(screen.getByRole('heading', { name: 'governedScopes.headerTitle' })).toBeInTheDocument();
    expect(screen.getByText('Quality assurance')).toBeInTheDocument();
    expect(screen.getByText('Approved quality assistant')).toBeInTheDocument();
    expect(screen.queryByText('governedScopes.defaultDescription')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal agent')).not.toBeInTheDocument();
    expect(screen.queryByText('governedScopes.badge')).not.toBeInTheDocument();
    expect(screen.queryByText('governedScopes.version')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'carousel.previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'carousel.next' })).toBeDisabled();
  });

  it('starts a governed conversation from a scope card', async () => {
    mocks.createConversation.mockResolvedValueOnce({ id: 'conversation-1' });
    render(<GovernedScopesCarousel />);

    fireEvent.click(screen.getByRole('button', { name: 'governedScopes.openAria' }));

    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalledWith('scope-1', expect.any(String)));
    expect(mocks.navigate).toHaveBeenCalledWith('/conversation/conversation-1');
  });

  it('keeps the retry action available when scopes fail to load', () => {
    mocks.queryResult.data = [];
    mocks.queryResult.isError = true;
    render(<GovernedScopesCarousel />);

    fireEvent.click(screen.getByRole('button', { name: 'governedScopes.retry' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
