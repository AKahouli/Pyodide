import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconciliationRunStatus } from './ReconciliationRunStatus';

const mocks = vi.hoisted(() => ({ run: { status: 'completed', dryRun: true, stats: { scannedDocuments: 3, missingSources: 1, missingVersions: 1, repairedStatuses: 0, missingArtifacts: 0 }, errors: [] } as Record<string, unknown>, resume: vi.fn(), importUpdates: vi.fn() }));

vi.mock('@/modules/governance', () => ({
  useGovernanceReconciliationRun: () => ({ data: mocks.run }),
  useResumeGovernanceReconciliationRun: () => ({ mutate: mocks.resume, isPending: false }),
}));

describe('ReconciliationRunStatus', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.run = { status: 'completed', dryRun: true, stats: { scannedDocuments: 3, missingSources: 1, missingVersions: 1, repairedStatuses: 0, missingArtifacts: 0 }, errors: [] }; });

  it('offers import only after a check finds updates', () => {
    render(<ReconciliationRunStatus programId='program-1' bindingId='binding-1' runId='run-1' importAllowed importPending={false} onImport={mocks.importUpdates} />);
    expect(screen.getByText('workspaceBinding.updateCheck.available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'workspaceBinding.updateCheck.import' }));
    expect(mocks.importUpdates).toHaveBeenCalledOnce();
  });

  it('shows up-to-date status without an import action when no updates exist', () => {
    mocks.run = { status: 'completed', dryRun: true, stats: { scannedDocuments: 3, missingSources: 0, missingVersions: 0, repairedStatuses: 0, missingArtifacts: 0 }, errors: [] };
    render(<ReconciliationRunStatus programId='program-1' bindingId='binding-1' runId='run-1' importAllowed importPending={false} onImport={mocks.importUpdates} />);
    expect(screen.getByText('workspaceBinding.updateCheck.upToDate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'workspaceBinding.updateCheck.import' })).not.toBeInTheDocument();
  });

  it('explains Manual mode instead of offering import', () => {
    render(<ReconciliationRunStatus programId='program-1' bindingId='binding-1' runId='run-1' importAllowed={false} importPending={false} onImport={mocks.importUpdates} />);
    expect(screen.getByText('workspaceBinding.updateCheck.manualHelp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'workspaceBinding.updateCheck.import' })).not.toBeInTheDocument();
  });
});
