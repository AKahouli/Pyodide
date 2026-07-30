import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ProviderIcon } from './ProviderIcon';

// Break icons ↔ ThemeContext ↔ auth barrel cycle so Icons resolves for this suite
vi.mock('@/contexts/ThemeContext', () => ({
  ThemeProviderContext: { Provider: ({ children }: { children: ReactNode }) => children },
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));

describe('ProviderIcon', () => {
  it('should render Microsoft icon for "microsoft" key', () => {
    const { container } = render(<ProviderIcon iconKey="microsoft" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // Microsoft icon has 4 colored squares
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(4);
  });

  it('should render Google icon for "google" key', () => {
    const { container } = render(<ProviderIcon iconKey="google" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(4);
  });

  it('should render GitHub icon for "github" key', () => {
    const { container } = render(<ProviderIcon iconKey="github" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should render Okta icon for "okta" key', () => {
    const { container } = render(<ProviderIcon iconKey="okta" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should render fallback KeyRound icon for unknown key', () => {
    const { container } = render(<ProviderIcon iconKey="unknown-provider" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should be case-insensitive for icon keys', () => {
    const { container: lower } = render(<ProviderIcon iconKey="microsoft" />);
    const { container: upper } = render(<ProviderIcon iconKey="MICROSOFT" />);

    const lowerPaths = lower.querySelectorAll('path').length;
    const upperPaths = upper.querySelectorAll('path').length;
    expect(lowerPaths).toBe(upperPaths);
  });

  it('should apply custom className', () => {
    const { container } = render(
      <ProviderIcon iconKey="microsoft" className="h-8 w-8" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('h-8');
    expect(svg?.getAttribute('class')).toContain('w-8');
  });

  it('should use default className when not provided', () => {
    const { container } = render(<ProviderIcon iconKey="microsoft" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('h-5');
    expect(svg?.getAttribute('class')).toContain('w-5');
  });
});
