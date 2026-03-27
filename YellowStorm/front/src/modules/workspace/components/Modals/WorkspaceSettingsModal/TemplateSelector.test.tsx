import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TemplateSelector } from './TemplateSelector';

describe('TemplateSelector', () => {
  it('returns null when no templates are provided', () => {
    const { container } = render(<TemplateSelector templates={[]} isLoading={false} disabled={false} onApply={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders template entries when templates exist', () => {
    render(
      <TemplateSelector
        templates={[
          {
            id: 't1',
            name: 'Template 1',
            isTemplate: true,
            isPredefined: true,
            createdBy: 'u1',
            chunks: 4,
            ragType: 'standard',
            topK: 5,
            maxToken: 4000,
            hybridSearch: true,
            createdAt: '',
            updatedAt: '',
          },
        ]}
        isLoading={false}
        disabled={false}
        onApply={() => undefined}
      />,
    );

    expect(screen.getByText('settings.template.title')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
