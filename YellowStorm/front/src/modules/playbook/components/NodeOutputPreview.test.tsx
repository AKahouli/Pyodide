import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NodeOutputPreview } from './NodeOutputPreview';
import type { TaskResult } from '../types';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./PlaybookArtifactActions', () => ({ PlaybookArtifactActions: ({ executionId, artifactId }: { executionId: string; artifactId: string }) => <span>{executionId}:{artifactId}</span> }));

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:preview'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

describe('NodeOutputPreview', () => {
  it('shows actual output beside the node and preserves artifact execution identity', () => {
    const onDetails = vi.fn();
    const { container } = render(<NodeOutputPreview executionId="execution-7" onDetails={onDetails} result={{
      status: 'completed', displayText: '<script>not executable</script>', output: 'raw fallback',
      artifacts: [{ artifactId: 'file-1', filename: 'report.txt', artifactKind: 'text', portId: 'default' }],
    } as TaskResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'nodeOutput.open' }));
    expect(screen.getByTitle('Preview')).toHaveAttribute('src', 'blob:preview');
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

  it('renders markdown tables with the shared step result renderer', () => {
    render(<NodeOutputPreview onDetails={() => {}} result={{
      status: 'completed',
      output: '| Filename | Format |\n|---|---|\n| resume.pdf | PDF |',
    } as TaskResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'nodeOutput.open' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('resume.pdf')).toBeInTheDocument();
  });

  it('renders completed results that only contain structured components', () => {
    render(<NodeOutputPreview onDetails={() => {}} result={{
      status: 'completed',
      components: [{ type: 'text', data: { content: 'Structured result' } }],
    } as unknown as TaskResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'nodeOutput.open' }));
    expect(screen.getByText('Structured result')).toBeInTheDocument();
  });

  it('keeps structured components alongside an HTML result', () => {
    render(<NodeOutputPreview onDetails={() => {}} result={{
      status: 'completed',
      output: '<html><body>Preview</body></html>',
      components: [{ type: 'text', data: { content: 'Supporting details' } }],
    } as unknown as TaskResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'nodeOutput.open' }));
    expect(screen.getByTitle('Preview')).toBeInTheDocument();
    expect(screen.getByText('Supporting details')).toBeInTheDocument();
  });

  it('uses an icon-only compact result control', () => {
    render(<NodeOutputPreview compact onDetails={() => {}} result={{ status: 'completed', output: 'Done' } as TaskResult} />);
    const trigger = screen.getByRole('button', { name: 'nodeOutput.open' });
    expect(trigger.querySelector('svg')).toBeInTheDocument();
    expect(trigger.querySelector('span')).toBeNull();
    expect(screen.queryByText('nodeOutput.ready')).not.toBeInTheDocument();
  });
});
