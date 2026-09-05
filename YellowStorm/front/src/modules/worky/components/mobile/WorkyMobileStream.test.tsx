import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useWorkyUiStore } from '../../uiStore';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (k === 'agents.team.count') return `${opts?.count} agents`;
      return k;
    },
    language: 'en',
    ready: true,
  }),
}));

vi.mock('../../agents/useStreamAgents', () => ({ useStreamAgents: vi.fn() }));
// Sheets are covered by their own specs; stub them here to keep this wiring
// test light (their real import chains pull in ai-elements + audio recorder).
vi.mock('./TaskDetailSheet', () => ({ TaskDetailSheet: () => null }));
vi.mock('./ApprovalSheet', () => ({ ApprovalSheet: () => null }));
vi.mock('./ManagerChatSheet', () => ({ ManagerChatSheet: () => null }));
vi.mock('../PlanDeltaToast', () => ({ PlanDeltaToast: () => null }));
vi.mock('../voice/VoiceSession', () => ({
  VoiceSession: ({ open }: { open: boolean }) => (open ? <div>voice-session-open</div> : null),
}));
vi.mock('./MobileStreamHeader', () => ({ MobileStreamHeader: () => <div>stream-header</div> }));
vi.mock('../executive/WorkyExecutiveView', () => ({ WorkyExecutiveView: () => <div>Atlas</div> }));

import { useStreamAgents } from '../../agents/useStreamAgents';
import { WorkyMobileStream } from './WorkyMobileStream';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: unknown) => fn as any;
const model = {
  plan: null, session: null, health: 'planning' as const, runtimeAsks: [], interactions: [],
  currentWork: [], delegations: [], summary: { total: 0, completed: 0, active: 0, waitingExternal: 0, needsInput: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkyUiStore.getState().reset();
  asMock(useStreamAgents).mockReturnValue({
    agents: [
      {
        key: 'a',
        name: 'Atlas',
        role: 'Research',
        initials: 'A',
        colorSeed: 'x',
        status: 'working',
        currentTask: null,
        tasks: [],
        doneCount: 0,
        totalCount: 1,
      },
    ],
    ungrouped: [],
  });
});

describe('WorkyMobileStream', () => {
  it('renders the agent team and the bottom nav', () => {
    render(
      <MemoryRouter>
        <WorkyMobileStream streamId="s1" approvalFor={null} onApprovalClose={() => {}} model={model} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Atlas')).toBeTruthy();
    expect(screen.getByText('nav.chat')).toBeTruthy();
    expect(screen.getByLabelText('nav.voice')).toBeTruthy();
  });

  it('opens the voice session from the nav voice button', async () => {
    render(
      <MemoryRouter>
        <WorkyMobileStream streamId="s1" approvalFor={null} onApprovalClose={() => {}} model={model} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('voice-session-open')).toBeNull();
    await userEvent.click(screen.getByLabelText('nav.voice'));
    expect(screen.getByText('voice-session-open')).toBeTruthy();
  });
});
