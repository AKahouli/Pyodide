import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { CreateTemplateModalHeader } from './CreateTemplateModalHeader';

describe('CreateTemplateModalHeader', () => {
  it('renders title and step indicator', () => {
    render(
      <Dialog open>
        <DialogContent>
          <CreateTemplateModalHeader currentStep={2} />
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('modal.createTemplate.title')).toBeInTheDocument();
  });
});
