import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SettingsHeader } from './SettingsHeader';

describe('SettingsHeader', () => {
  it('renders workspace-specific description when name is provided', () => {
    render(
      <Dialog open>
        <DialogContent>
          <SettingsHeader workspaceName='Acme Workspace' />
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('settings.modal.title')).toBeInTheDocument();
    expect(screen.getByText('settings.modal.descriptionWithName')).toBeInTheDocument();
  });
});
