import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateStudioBootState } from './TemplateStudioBootState';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('TemplateStudioBootState', () => {
  it('renders the preparing title and boot checklist', () => {
    render(<TemplateStudioBootState />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('templateStudio.preparingTitle')).toBeInTheDocument();
    expect(screen.getByText('templateStudio.bootUnpack')).toBeInTheDocument();
    expect(screen.getByText('templateStudio.bootInstall')).toBeInTheDocument();
    expect(screen.getByText('templateStudio.bootServer')).toBeInTheDocument();
    expect(screen.getByText('templateStudio.bootReady')).toBeInTheDocument();
  });
});
