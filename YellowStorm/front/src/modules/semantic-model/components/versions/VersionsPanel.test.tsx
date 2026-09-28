import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionsPanel } from './VersionsPanel';

const publish = vi.fn();
const comparisons: Array<[string | undefined, string | undefined]> = [];
let versions: Array<Record<string, unknown>> = [];

vi.mock('../../api', () => ({ semanticModelApi: { publish: (...args: unknown[]) => publish(...args), restore: vi.fn() } }));
vi.mock('../../query/hooks', () => ({
  useSemanticVersions: () => ({ isLoading: false, refetch: vi.fn(), data: versions }),
  useVersionComparison: (_id: string, left?: string, right?: string) => {
    comparisons.push([left, right]);
    return {
      isLoading: false, isError: false,
      data: left && right ? {
        changes: [
          { kind: 'concept_renamed', from: 'Customer', to: 'Client' },
          { kind: 'relation_cardinality_changed', relation: 'signs', source: 'Client', target: 'Contract', from: 'one_to_many', to: 'many_to_many' },
        ],
        records: { before: 100, after: 120, change: 20 },
      } : undefined,
    };
  },
}));

describe('VersionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comparisons.length = 0;
    versions = [
      { id: 'draft', versionNumber: 2, status: 'draft', createdAt: '2026-08-02T00:00:00.000Z' },
      { id: 'published', versionNumber: 1, status: 'published', createdAt: '2026-08-01T00:00:00.000Z' },
    ];
  });

  it('hides publish and restore actions when the model is read-only', () => {
    versions = [{ id: 'version', versionNumber: 1, status: 'published', createdAt: '2026-08-01T00:00:00.000Z' }];
    render(<VersionsPanel modelId='model' canEdit={false} canPublish={false} onPublished={vi.fn()} />);
    expect(screen.queryByText('versions.publish')).not.toBeInTheDocument();
    expect(screen.queryByText('versions.restore')).not.toBeInTheDocument();
    expect(screen.getByText('versions.number')).toBeInTheDocument();
  });

  it('shows what changes if the draft is published, including record counts', () => {
    render(<VersionsPanel modelId='model' canEdit canPublish onPublished={vi.fn()} />);
    expect(screen.getByText('versionChanges.ifYouPublish')).toBeInTheDocument();
    expect(comparisons).toContainEqual(['published', 'draft']);
    expect(screen.getAllByText('versionChanges.concept_renamed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('versionChanges.relation_cardinality_changed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('versionChanges.recordsMore').length).toBeGreaterThan(0);
  });

  it('asks for confirmation with the change summary before publishing', async () => {
    publish.mockResolvedValue({ data: { published: true } });
    render(<VersionsPanel modelId='model' canEdit canPublish onPublished={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /versions.publish/ }));
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByText('versionChanges.confirmTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /versionChanges.confirmPublish/ }));
    expect(publish).toHaveBeenCalledWith('model');
  });

  it('compares any version with the draft', () => {
    versions.push({ id: 'older', versionNumber: 0, status: 'archived', createdAt: '2026-07-01T00:00:00.000Z' });
    render(<VersionsPanel modelId='model' canEdit canPublish onPublished={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /versionChanges.compareWithDraft/ })[1]);
    expect(comparisons.at(-1)).toEqual(['older', 'draft']);
  });
});
