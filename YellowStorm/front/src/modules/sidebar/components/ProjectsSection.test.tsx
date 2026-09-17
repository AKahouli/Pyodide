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
  useProjects: () => [],
  useSharedProjects: () => [],
  useProjectStore: (selector: (state: typeof projectStore) => unknown) => selector(projectStore),
  CreateProjectDialog: () => null,
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
});
