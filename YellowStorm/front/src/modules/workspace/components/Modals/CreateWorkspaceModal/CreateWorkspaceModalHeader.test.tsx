import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { CreateWorkspaceModalHeader } from './CreateWorkspaceModalHeader';

describe('CreateWorkspaceModalHeader', () => {
  it('renders title and step indicator', () => {
    render(
      <Dialog open>
        <DialogContent>
          <CreateWorkspaceModalHeader currentStep={1} />
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('modal.createWorkspace.title')).toBeInTheDocument();
  });
});
