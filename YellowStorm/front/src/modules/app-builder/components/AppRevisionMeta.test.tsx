import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AppRevisionMeta } from './AppRevisionMeta';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === 'card.deployedRevision') return `Deployed version · ${vars?.revision}`;
      if (key === 'card.latestRevision') {
        return `Latest version · ${vars?.revision} (${vars?.date})`;
      }
      if (key === 'card.latestRevisionWithCount') {
        return `Latest version · ${vars?.revision} (${vars?.date}) · ${vars?.count} versions`;
      }
      return key;
    },
    language: 'en',
  }),
}));

describe('AppRevisionMeta', () => {
  it('shows deployed and latest revision lines', () => {
    render(
      <AppRevisionMeta
        revision={{
          lastDeployedRevisionId: 'rev_7',
          latestFinalizedRevisionId: 'rev_12',
          latestFinalizedAt: '2026-09-02T10:00:00.000Z',
          finalizedVersionCount: 3,
        }}
      />,
    );

    expect(screen.getByText('Deployed version · rev_7')).toBeInTheDocument();
    expect(
      screen.getByText('Latest version · rev_12 (09/02/2026) · 3 versions'),
    ).toBeInTheDocument();
  });

  it('hides deployed revision on drafts', () => {
    render(
      <AppRevisionMeta
        showDeployedRevision={false}
        revision={{
          lastDeployedRevisionId: 'rev_7',
          latestFinalizedRevisionId: 'rev_12',
          latestFinalizedAt: '2026-09-02T10:00:00.000Z',
          finalizedVersionCount: 1,
        }}
      />,
    );

    expect(screen.queryByText('Deployed version · rev_7')).not.toBeInTheDocument();
    expect(screen.getByText('Latest version · rev_12 (09/02/2026)')).toBeInTheDocument();
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
