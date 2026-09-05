import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskArtifact } from '../types';
import { PortArtifactPane } from './PortArtifactPane';

vi.mock('./PlaybookArtifactActions', () => ({
  PlaybookArtifactActions: () => <div>secure-artifact-actions</div>,
}));

const artifact: TaskArtifact = {
  portId: 'output',
  artifactKind: 'document',
  filename: 'report.pdf',
};

function renderPane(value: TaskArtifact) {
  return render(
    <PortArtifactPane
      portId="output"
      portName="Output"
      portKind="document"
      artifacts={[value]}
      defaultOpen
      executionId="execution-1"
      onInspectArtifact={vi.fn()}
    />,
  );
}

describe('PortArtifactPane', () => {
  it('hides generic actions for metadata-only artifacts', () => {
    renderPane({
      ...artifact,
      metadata: { data: { filename: 'report.pdf', availability: 'unverified' } },
    });
    expect(screen.queryByRole('button', { name: /view|voir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download|télécharger/i })).not.toBeInTheDocument();
  });

  it('shows the generic viewer when inline content exists', () => {
    renderPane({ ...artifact, content: 'preview' });
    expect(screen.getByRole('button', { name: /view|voir/i })).toBeInTheDocument();
  });

  it('uses secure actions for verified artifacts', () => {
    renderPane({ ...artifact, artifactId: 'a'.repeat(32) });
    expect(screen.getByText('secure-artifact-actions')).toBeInTheDocument();
  });
});
