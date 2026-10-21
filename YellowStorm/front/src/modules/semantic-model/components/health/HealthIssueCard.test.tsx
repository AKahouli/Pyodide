import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import ar from '../../locales/ar.json';
import type { HealthIssue } from '../../types';
import { HealthIssueCard } from './HealthIssueCard';

const locale = vi.hoisted(() => ({ codeLabel: '' }));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key === 'runtimeError.code' ? locale.codeLabel : key }),
}));

const issue: HealthIssue = {
  id: 'c:source_unavailable', conceptId: 'c', kind: 'documents_not_read', cause: 'mapping', severity: 'blocked',
  params: { concept: 'BPCE', count: 1, sourceCodes: 'asset_fetch_forbidden' }, impact: { rows: 1 },
  examples: [{ source: 'workspace/document', values: { asset_fetch_forbidden: 'Name, Date' } }],
};

describe('source failure diagnostics', () => {
  it.each([['en', en], ['fr', fr], ['ar', ar]] as const)('renders the existing localized code label in %s', (_language, messages) => {
    locale.codeLabel = messages.runtimeError.code;
    render(<HealthIssueCard issue={issue} concepts={[]} canEdit={false} onAction={vi.fn()} />);
    expect(screen.getByText(`${messages.runtimeError.code}:`)).toBeInTheDocument();
    expect(screen.getByText('asset_fetch_forbidden')).toBeInTheDocument();
    expect(screen.getByText('workspace/document')).toBeInTheDocument();
    expect(screen.getByText('asset_fetch_forbidden: Name, Date')).toBeInTheDocument();
  });

  it('does not invent a diagnostic code for older revisions', () => {
    render(<HealthIssueCard issue={{ ...issue, params: { concept: 'BPCE', count: 1 }, examples: [] }} concepts={[]} canEdit={false} onAction={vi.fn()} />);
    expect(screen.queryByText('asset_fetch_forbidden')).not.toBeInTheDocument();
  });
});
