import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceManagerSheet } from './WorkspaceManagerSheet';

vi.mock('@/modules/workspace/api', () => ({
  getWorkspaces: vi.fn(),
}));

vi.mock('../api', () => ({
  updateConversation: vi.fn(),
  fetchConversationWorkspaceDocuments: vi.fn(),
}));

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateConversation: vi.fn(),
    }),
}));

describe('WorkspaceManagerSheet', () => {
  it('renders sheet title when open', () => {
    render(
      <WorkspaceManagerSheet
        open
        onOpenChange={vi.fn()}
        conversationId='conv-1'
        workspaceIds={[]}
      />,
    );

    expect(screen.getByText('workspace.sheet.title')).toBeInTheDocument();
  });
});
