import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AppRevisionMeta, resolveCatalogVersionNumber } from './AppRevisionMeta';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === 'card.version') return `Version ${vars?.number}`;
      if (key === 'card.deployedRevision') return `Deployed version · ${vars?.version}`;
      if (key === 'card.latestRevision') {
        return `Latest version · ${vars?.version} (${vars?.date})`;
      }
      if (key === 'card.latestRevisionWithCount') {
        return `Latest version · ${vars?.version} (${vars?.date}) · ${vars?.count} versions`;
      }
      return key;
    },
    language: 'en',
  }),
}));

describe('resolveCatalogVersionNumber', () => {
  it('maps the latest finalized revision to Version N', () => {
    expect(resolveCatalogVersionNumber('rev_4', 'rev_4', 4)).toBe(4);
    expect(resolveCatalogVersionNumber('rev_12', 'rev_12', 2)).toBe(2);
  });

  it('maps the sole version to Version 1', () => {
    expect(resolveCatalogVersionNumber('rev_7', 'rev_7', 1)).toBe(1);
  });

  it('returns null for older revisions when only the count is known', () => {
    expect(resolveCatalogVersionNumber('rev_2', 'rev_4', 4)).toBeNull();
  });
});

describe('AppRevisionMeta', () => {
  it('shows human version labels instead of raw revision ids', () => {
    render(
      <AppRevisionMeta
        revision={{
          lastDeployedRevisionId: 'rev_4',
          latestFinalizedRevisionId: 'rev_4',
          latestFinalizedAt: '2026-09-19T10:00:00.000Z',
          finalizedVersionCount: 4,
        }}
      />,
    );

    expect(screen.getByText('Deployed version · Version 4')).toBeInTheDocument();
    expect(
      screen.getByText('Latest version · Version 4 (09/19/2026) · 4 versions'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/rev_4/)).not.toBeInTheDocument();
  });

  it('hides deployed revision on drafts', () => {
    render(
      <AppRevisionMeta
        showDeployedRevision={false}
        revision={{
          lastDeployedRevisionId: 'rev_7',
          latestFinalizedRevisionId: 'rev_7',
          latestFinalizedAt: '2026-09-02T10:00:00.000Z',
          finalizedVersionCount: 1,
        }}
      />,
    );

    expect(screen.queryByText(/Deployed version/)).not.toBeInTheDocument();
    expect(screen.getByText('Latest version · Version 1 (09/02/2026)')).toBeInTheDocument();
  });

  it('renders nothing when no revision data', () => {
    const { container } = render(
      <AppRevisionMeta
        revision={{
          lastDeployedRevisionId: null,
          latestFinalizedRevisionId: null,
          latestFinalizedAt: null,
          finalizedVersionCount: 0,
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
