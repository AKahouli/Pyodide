import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TemplatePreviewFrame } from './TemplatePreviewFrame';

describe('TemplatePreviewFrame', () => {
  it('covers the screenshot without stretching and keeps a 16:10 frame', () => {
    const { container } = render(
      <TemplatePreviewFrame src='https://cdn.test/cover.png' title='CRM' />,
    );

    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cdn.test/cover.png');
    expect(img).toHaveClass('object-cover');
    expect(img).toHaveClass('object-[center_12%]');
    expect(container.querySelector('.aspect-\\[16\\/10\\]')).toBeTruthy();
  });

  it('shows the empty state label when there is no cover', () => {
    render(
      <TemplatePreviewFrame title='Empty' emptyLabel='No preview image' chrome='none' />,
    );

    expect(screen.getByText('No preview image')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
