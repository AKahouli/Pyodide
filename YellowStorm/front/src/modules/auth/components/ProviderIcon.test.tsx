import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ProviderIcon } from './ProviderIcon';

describe('ProviderIcon', () => {
  it('should render Microsoft icon for "microsoft" key', () => {
    const { container } = renderWithProviders(<ProviderIcon iconKey="microsoft" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // Microsoft icon has 4 colored squares
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(4);
  });

  it('should render Google icon for "google" key', () => {
    const { container } = renderWithProviders(<ProviderIcon iconKey="google" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(4);
  });

  it('should render GitHub icon for "github" key', () => {
    const { container } = renderWithProviders(<ProviderIcon iconKey="github" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should render Okta icon for "okta" key', () => {
    const { container } = renderWithProviders(<ProviderIcon iconKey="okta" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should render fallback KeyRound icon for unknown key', () => {
    const { container } = renderWithProviders(<ProviderIcon iconKey="unknown-provider" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should be case-insensitive for icon keys', () => {
    const { container: lower } = renderWithProviders(<ProviderIcon iconKey="microsoft" />);
    const { container: upper } = renderWithProviders(<ProviderIcon iconKey="MICROSOFT" />);

    const lowerPaths = lower.querySelectorAll('path').length;
    const upperPaths = upper.querySelectorAll('path').length;
    expect(lowerPaths).toBe(upperPaths);
  });

  it('should apply custom className', () => {
    const { container } = renderWithProviders(
      <ProviderIcon iconKey="microsoft" className="h-8 w-8" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('h-8');
    expect(svg?.getAttribute('class')).toContain('w-8');
  });

  it('should use default className when not provided', () => {
    const { container } = renderWithProviders(<ProviderIcon iconKey="microsoft" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('h-5');
    expect(svg?.getAttribute('class')).toContain('w-5');
  });
});
