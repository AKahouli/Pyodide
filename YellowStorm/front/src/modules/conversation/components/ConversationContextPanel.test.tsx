import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationContextPanel } from './ConversationContextPanel';
import { initialConversationUiState, useConversationUiStore } from '../uiStore';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./RootWorkPanel', () => ({ RootWorkPanel: () => <div>Work details</div> }));
vi.mock('./RootInputPanel', () => ({ RootInputPanel: () => null }));
vi.mock('./outline/ConversationOutlineRail', () => ({ ConversationOutlineRail: ({ onSelect }: { onSelect?: () => void }) => <button onClick={onSelect}>Heading</button> }));

describe('ConversationContextPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useConversationUiStore.setState(initialConversationUiState);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1100 } as DOMRect);
  });

  it('starts with no visible pane or collapsed rail', () => {
    render(<ConversationContextPanel conversationId='c1' creatorId='u1' />);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resizes by keyboard within bounds and coordinates tabs in one pane', () => {
    useConversationUiStore.getState().setContextPanel('outline');
    render(<ConversationContextPanel conversationId='c1' creatorId='u1' />);
    const resize = screen.getByRole('separator');
    fireEvent.keyDown(resize, { key: 'ArrowLeft' });
    expect(useConversationUiStore.getState().contextPanelWidth).toBe(340);
    fireEvent.keyDown(resize, { key: 'End' });
    expect(useConversationUiStore.getState().contextPanelWidth).toBe(480);
    fireEvent.doubleClick(resize);
    expect(useConversationUiStore.getState().contextPanelWidth).toBe(320);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'contextPanel.work' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('Work details')).toBeInTheDocument();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'contextPanel.close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('uses an accessible overlay in narrow containers and closes after outline selection', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600 } as DOMRect);
    useConversationUiStore.getState().setContextPanel('outline');
    render(<ConversationContextPanel conversationId='c1' creatorId='u1' />);
    expect(screen.getByRole('dialog', { name: 'contextPanel.title' })).toBeInTheDocument();
    expect(screen.queryByRole('separator')).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Heading' })));
    expect(useConversationUiStore.getState().contextPanel).toBeNull();
  });

  it.each([600, 1100])('restores keyboard focus to the opener after Escape at width %s', async (width) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect);
    render(<><button onClick={() => useConversationUiStore.getState().setContextPanel('outline')}>Open outline</button><ConversationContextPanel conversationId='c1' creatorId='u1' /></>);
    const opener = screen.getByRole('button', { name: 'Open outline' });
    await userEvent.click(opener);
    const close = screen.getByRole('button', { name: 'contextPanel.close' });
    close.focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
    expect(useConversationUiStore.getState().contextPanel).toBeNull();
  });
});
