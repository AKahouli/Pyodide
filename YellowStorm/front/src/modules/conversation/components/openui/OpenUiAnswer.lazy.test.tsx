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
describe('OpenUiAnswer chunk loading', () => {
  it('retries a failed chunk load once before giving up', async () => {
    loader.load.mockRejectedValueOnce(new Error('chunk failed')).mockResolvedValue(stub);
    render(answer(false));
    expect(await screen.findByTestId('openui-stub')).toBeInTheDocument();
    expect(loader.load).toHaveBeenCalledTimes(2);
  });
});
