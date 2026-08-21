import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlatformCopilotHistoryDialog } from './PlatformCopilotHistoryDialog';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    language: 'en',
    t: (key: string) => ({
      'history.title': 'Conversation history',
      'history.description': 'Earlier conversations',
      'history.search': 'Search conversations',
      'history.loading': 'Loading conversations...',
      'history.empty': 'No conversations found.',
      'history.current': 'Current conversation',
    }[key] ?? key),
  }),
}));

describe('PlatformCopilotHistoryDialog', () => {
  it('filters history and selects a conversation', async () => {
    const onSelect = vi.fn().mockResolvedValue(true);
    const onOpenChange = vi.fn();
    render(<PlatformCopilotHistoryDialog
      open
      onOpenChange={onOpenChange}
      activeConversationId='conversation-1'
      loading={false}
      onSelect={onSelect}
      conversations={[
        { id: 'conversation-1', title: 'Lead generation', createdBy: 'u1', messageCount: 2, lastMessageAt: '2026-08-16T10:00:00Z', isArchived: false, isShared: false, createdAt: '2026-08-16T09:00:00Z', updatedAt: '2026-08-16T10:00:00Z' },
        { id: 'conversation-2', title: 'CV scoring', createdBy: 'u1', messageCount: 4, lastMessageAt: '2026-08-16T11:00:00Z', isArchived: false, isShared: false, createdAt: '2026-08-16T09:00:00Z', updatedAt: '2026-08-16T11:00:00Z' },
      ]}
    />);

    fireEvent.change(screen.getByPlaceholderText('Search conversations'), { target: { value: 'CV' } });
    expect(screen.queryByText('Lead generation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /CV scoring/ }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('conversation-2'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
