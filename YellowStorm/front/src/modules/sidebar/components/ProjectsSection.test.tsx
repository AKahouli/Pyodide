import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { ProjectsSection } from './ProjectsSection';

const projectStore = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  fetchSharedProjects: vi.fn(),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/modules/project', () => ({
  useProjects: () => [{ id: 'p1', name: 'Project Alpha' }],
  useSharedProjects: () => [],
  useProjectStore: (selector: (state: typeof projectStore) => unknown) => selector(projectStore),
  CreateProjectDialog: ({ open }: { open: boolean }) => open ? <div role='dialog' aria-label='create-project-preview'>Create project</div> : null,
  RenameProjectDialog: () => null,
  DeleteProjectDialog: () => null,
}));
vi.mock('@/modules/conversation/store', () => ({
  useConversationStore: () => vi.fn(),
}));

function renderProjects() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <ProjectsSection label='Projects' />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('ProjectsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('starts collapsed on every mount and remains manually openable', async () => {
    localStorage.setItem('projects:sectionOpen', 'true');
    const first = renderProjects();
    const projects = screen.getByRole('button', { name: 'Projects' });

    expect(projects).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(projects);
    expect(projects).toHaveAttribute('aria-expanded', 'true');

    first.unmount();
    renderProjects();
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows projects in a flyout and keeps its create dialog mounted', async () => {
    render(<MemoryRouter><SidebarProvider defaultOpen={false}><ProjectsSection label='Projects' flyout /></SidebarProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Project Alpha' })).toHaveAttribute('href', '/projet/p1');
    await userEvent.click(screen.getByRole('button', { name: 'conversations.newProject' }));
    expect(screen.getByRole('dialog', { name: 'create-project-preview' })).toBeInTheDocument();
  });

  it('reveals the current project in the expanded navigation', () => {
    render(<MemoryRouter initialEntries={['/projet/p1']}><SidebarProvider><ProjectsSection label='Projects' /></SidebarProvider></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Project Alpha' })).toBeInTheDocument();
  });
});
