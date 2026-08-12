import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionsPanel } from './VersionsPanel';

vi.mock('../../query/hooks', () => ({
  useSemanticVersions:() => ({isLoading:false,refetch:vi.fn(),data:[{id:'version',versionNumber:1,status:'published',createdAt:'2026-08-01T00:00:00.000Z'}]}),
}));

describe('VersionsPanel', () => {
  it('hides publish and restore actions when the model is read-only', () => {
    render(<VersionsPanel modelId='model' canEdit={false} canPublish={false} onPublished={vi.fn()} />);
    expect(screen.queryByText('versions.publish')).not.toBeInTheDocument();
    expect(screen.queryByText('versions.restore')).not.toBeInTheDocument();
    expect(screen.getByText('versions.number')).toBeInTheDocument();
  });
});
