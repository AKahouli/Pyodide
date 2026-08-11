import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));
// The rail only needs to mount these; their own suites cover their behaviour.
vi.mock('../ChatMessageThread', () => ({
  ChatMessageThread: () => <div data-testid="thread" />,
}));
vi.mock('../PromptBar', () => ({ PromptBar: () => <div data-testid="composer" /> }));

import { WorkyActivityRail } from './WorkyActivityRail';
import { useWorkyUiStore } from '../../uiStore';

beforeEach(() => useWorkyUiStore.getState().reset());

describe('WorkyActivityRail', () => {
  it('opens on the chat tab with the manager thread and composer', () => {
    render(<WorkyActivityRail streamId="s1" />);
    expect(screen.getByTestId('worky-rail-chat')).toBeTruthy();
    expect(screen.getByTestId('thread')).toBeTruthy();
    expect(screen.getByTestId('composer')).toBeTruthy();
    // The voice card moved out of the rail and into the bottom-center dock.
    expect(screen.queryByText('voice.manager')).toBeNull();
    expect(screen.queryByText('voice.tapToTalk')).toBeNull();
  });

  it('does not render a budget card', () => {
    render(<WorkyActivityRail streamId="s1" />);
    expect(screen.queryByText('budget.title')).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('switches to the activity tab and shows live activity items', () => {
    useWorkyUiStore
      .getState()
      .pushActivity({ key: 'a1', icon: 'check', tone: 'working', text: 'A task was completed' });
    render(<WorkyActivityRail streamId="s1" />);

    fireEvent.click(screen.getByTestId('worky-rail-tab-activity'));

    expect(screen.getByTestId('worky-rail-activity')).toBeTruthy();
    expect(screen.getByText('A task was completed')).toBeTruthy();
    expect(screen.queryByTestId('worky-rail-chat')).toBeNull();
  });

  it('shows an empty state on the activity tab when there is no activity', () => {
    render(<WorkyActivityRail streamId="s1" />);
    fireEvent.click(screen.getByTestId('worky-rail-tab-activity'));
    expect(screen.getByText('activity.empty')).toBeTruthy();
  });
});
