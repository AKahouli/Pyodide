import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));
vi.mock('../ChatMessageThread', () => ({ ChatMessageThread: () => <div>chat-thread</div> }));
vi.mock('../PromptBar', () => ({ PromptBar: () => <div>prompt-bar</div> }));

import { ManagerChatSheet } from './ManagerChatSheet';

describe('ManagerChatSheet', () => {
  it('renders the chat thread and composer when open', () => {
    render(<ManagerChatSheet streamId="s1" open onOpenChange={() => {}} />);
    expect(screen.getByText('chat-thread')).toBeTruthy();
    expect(screen.getByText('prompt-bar')).toBeTruthy();
    expect(screen.getByText('messages.description')).toBeTruthy();
  });
});
