import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookClarificationResourcePicker } from './PlaybookClarificationResourcePicker';

const workspaceApiMocks = vi.hoisted(() => ({
  getWorkspaces: vi.fn(),
  getHierarchicalDocuments: vi.fn(),
}));

const translationMocks = vi.hoisted(() => ({
  t: vi.fn((key: string, options?: Record<string, string>) => options?.name ? `${key}:${options.name}` : key),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: translationMocks.t }),
}));

vi.mock('@/modules/workspace/api', () => ({
  getWorkspaces: workspaceApiMocks.getWorkspaces,
  getHierarchicalDocuments: workspaceApiMocks.getHierarchicalDocuments,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('PlaybookClarificationResourcePicker', () => {
  it('ignores stale document responses when switching workspaces', async () => {
    const firstDocuments = deferred<{ documents: Array<Record<string, unknown>> }>();
    const secondDocuments = deferred<{ documents: Array<Record<string, unknown>> }>();
    workspaceApiMocks.getWorkspaces.mockResolvedValue({
      workspaces: [
        { id: 'workspace-1', name: 'Finance', documentCount: 1 },
        { id: 'workspace-2', name: 'Legal', documentCount: 1 },
      ],
    });
    workspaceApiMocks.getHierarchicalDocuments
      .mockReturnValueOnce(firstDocuments.promise)
      .mockReturnValueOnce(secondDocuments.promise);

    render(
      <PlaybookClarificationResourcePicker
        open
        mode="workspace_or_document"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText('intentBar.design.resource.workspaceLabel')).toHaveValue('workspace-1'));
    fireEvent.change(screen.getByLabelText('intentBar.design.resource.workspaceLabel'), { target: { value: 'workspace-2' } });
    secondDocuments.resolve({
      documents: [{ id: 'legal-doc', filename: 'legal.pdf', originalName: 'Legal Brief.pdf', mimeType: 'application/pdf', path: '/Legal/Brief.pdf', workspaceId: 'workspace-2', isFolder: false }],
    });
    await waitFor(() => expect(screen.getByText('Legal Brief.pdf')).toBeInTheDocument());

    firstDocuments.resolve({
      documents: [{ id: 'finance-doc', filename: 'finance.pdf', originalName: 'Finance Report.pdf', mimeType: 'application/pdf', path: '/Finance/Report.pdf', workspaceId: 'workspace-1', isFolder: false }],
    });

    await waitFor(() => expect(screen.queryByText('Finance Report.pdf')).not.toBeInTheDocument());
    expect(screen.getByText('Legal Brief.pdf')).toBeInTheDocument();
  });
});
