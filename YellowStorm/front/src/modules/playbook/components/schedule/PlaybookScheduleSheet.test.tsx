import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlaybookScheduleSheet } from './PlaybookScheduleSheet';

const storeMock = vi.hoisted(() => ({
  upsertPlaybookTriggerSchedule: vi.fn(),
  clearPlaybookTriggerSchedule: vi.fn(),
  triggerSaving: false,
}));

vi.mock('../../store', () => ({
  usePlaybookStore: (selector: (state: typeof storeMock) => unknown) => selector(storeMock),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

describe('PlaybookScheduleSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.triggerSaving = false;
  });

  it('shows manual trigger and hides schedule editors when no automated trigger is selected', () => {
    render(
      <PlaybookScheduleSheet
        open
        onOpenChange={vi.fn()}
        playbookId="p1"
        schedule={null}
      />,
    );

    expect(screen.getByText('triggers.manual.title')).toBeInTheDocument();
    expect(screen.getByText('triggers.description')).toBeInTheDocument();
    expect(screen.getByText('triggers.automated.noneTitle')).toBeInTheDocument();
    expect(screen.getByText('triggers.automated.scheduleTitle')).toBeInTheDocument();
    expect(screen.getByText('triggers.automated.mailTitle')).toBeInTheDocument();
    expect(screen.getByText('triggers.comingSoon')).toBeInTheDocument();
    expect(screen.queryByText('schedule.mode')).not.toBeInTheDocument();
  });

  it('reveals schedule controls when schedule is selected', async () => {
    render(
      <PlaybookScheduleSheet
        open
        onOpenChange={vi.fn()}
        playbookId="p1"
        schedule={null}
      />,
    );

    await userEvent.click(screen.getByRole('radio', { name: /triggers\.automated\.scheduleTitle/i }));

    expect(screen.getByText('schedule.mode')).toBeInTheDocument();
  });

  it('saves a disabled automated trigger when none is selected', async () => {
    render(
      <PlaybookScheduleSheet
        open
        onOpenChange={vi.fn()}
        playbookId="p1"
        schedule={null}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'schedule.save' }));

    expect(storeMock.upsertPlaybookTriggerSchedule).toHaveBeenCalledWith('p1', { enabled: false });
  });
});
