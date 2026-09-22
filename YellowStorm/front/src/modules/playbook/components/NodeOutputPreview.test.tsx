import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeOutputPreview } from './NodeOutputPreview';
import type { TaskResult } from '../types';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./PlaybookArtifactActions', () => ({ PlaybookArtifactActions: ({ executionId, artifactId }: { executionId: string; artifactId: string }) => <span>{executionId}:{artifactId}</span> }));

describe('NodeOutputPreview', () => {
  it('shows actual escaped output beside the node and preserves artifact execution identity', () => {
    const onDetails = vi.fn();
    const { container } = render(<NodeOutputPreview executionId="execution-7" onDetails={onDetails} result={{
      status: 'completed', displayText: '<script>not executable</script>', output: 'raw fallback',
      artifacts: [{ artifactId: 'file-1', filename: 'report.txt', artifactKind: 'text', portId: 'default' }],
    } as TaskResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'nodeOutput.open' }));
    expect(screen.getByText('<script>not executable</script>')).toBeInTheDocument();
    expect(screen.queryByText('raw fallback')).not.toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('execution-7:file-1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('nodeOutput.details'));
    expect(onDetails).toHaveBeenCalledOnce();
  });

  it('does not present sample or incomplete output as a successful result', () => {
    render(<NodeOutputPreview onDetails={() => {}} result={{ status: 'running', output: 'partial' } as TaskResult} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses a compact result label beside an output port', () => {
    render(<NodeOutputPreview compact onDetails={() => {}} result={{ status: 'completed', output: 'Done' } as TaskResult} />);
    expect(screen.getByRole('button', { name: 'nodeOutput.open' })).toHaveTextContent('nodeOutput.badge');
    expect(screen.queryByText('nodeOutput.ready')).not.toBeInTheDocument();
  });
});
