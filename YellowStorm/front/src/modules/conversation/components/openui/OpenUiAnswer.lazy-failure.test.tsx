import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpenUiAnswer } from './OpenUiAnswer';

const loader = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
vi.mock('../../store', () => ({ useConversationStore: { getState: () => ({ sendMessage: vi.fn() }) } }));
vi.mock('./preload', () => ({ loadOpenUiRenderer: loader.load }));

const stub = { default: ({ content }: { content: string }) => <div data-testid='openui-stub'>{content}</div> };
const answer = (isStreaming: boolean, content = 'root = Stack([])') => <OpenUiAnswer content={content} isStreaming={isStreaming} conversationId='c' messageId='m' />;

// A fresh module per file: React's lazy() starts uncached here.
describe('OpenUiAnswer chunk loading failure', () => {
  it('shows markdown when the load keeps failing, then loads again on the next mount', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      loader.load.mockReset();
      loader.load.mockRejectedValue(new Error('offline'));
      const first = render(answer(false, 'root = Stack([a])\na = TextContent("kept")'));
      await waitFor(() => expect(first.container.textContent).toContain('kept'));
      expect(screen.queryByTestId('openui-stub')).not.toBeInTheDocument();
      first.unmount();
      loader.load.mockReset();
      loader.load.mockResolvedValue(stub);
      render(answer(false));
      expect(await screen.findByTestId('openui-stub')).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
