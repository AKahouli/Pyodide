import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { WorkspaceModalContent } from './WorkspaceModalContent';

vi.mock('../../WorkspaceSidebar', () => ({ WorkspaceSidebar: () => <div>workspace-sidebar</div> }));
vi.mock('../../WorkspaceContent', () => ({ WorkspaceContent: () => <div>workspace-content</div> }));

describe('WorkspaceModalContent', () => {
  it('renders sidebar and content blocks', () => {
    render(
      <Dialog open>
        <DialogContent>
          <WorkspaceModalContent isMobileSidebarOpen />
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText('workspace-sidebar')).toBeInTheDocument();
    expect(screen.getByText('workspace-content')).toBeInTheDocument();
    expect(screen.getByText('modal.managerTitle')).toBeInTheDocument();
  });
});
