import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlaybookScheduleSheet } from './PlaybookScheduleSheet';

const storeMock = vi.hoisted(() => ({
  upsertPlaybookTriggerSchedule: vi.fn(),
  clearPlaybookTriggerSchedule: vi.fn(),
  upsertPlaybookTriggerMail: vi.fn(),
  clearPlaybookTriggerMail: vi.fn(),
  triggerSaving: false,
}));

vi.mock('../../store', () => ({
  usePlaybookStore: (selector: (state: typeof storeMock) => unknown) => selector(storeMock),
}));

const mailboxCapabilityMock = vi.hoisted(() => ({
  current: null as null | {
    connected: boolean;
    mailboxReady: boolean;
    missingScopes: string[];
    grantedScopes: string[];
  },
}));

vi.mock('@/modules/connected-app/store', () => ({
  useMailboxCapability: () => mailboxCapabilityMock.current,
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
    mailboxCapabilityMock.current = null;
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

  it('shows mailbox readiness hint for future mail trigger support', () => {
    mailboxCapabilityMock.current = {
      connected: true,
      mailboxReady: true,
      missingScopes: [],
      grantedScopes: ['mail.read'],
    };

    render(
      <PlaybookScheduleSheet
        open
        onOpenChange={vi.fn()}
        playbookId="p1"
        schedule={null}
      />,
    );

    expect(screen.getByText('triggers.automated.mailReady')).toBeInTheDocument();
  });

  it('shows missing mailbox scopes hint when mail permissions are incomplete', () => {
    mailboxCapabilityMock.current = {
      connected: true,
      mailboxReady: false,
      missingScopes: ['mail.read'],
      grantedScopes: ['files.read'],
    };

    render(
      <PlaybookScheduleSheet
        open
        onOpenChange={vi.fn()}
        playbookId="p1"
        schedule={null}
      />,
    );

    expect(screen.getByText('triggers.automated.mailScopesMissing')).toBeInTheDocument();
  });

  it('saves mail trigger filters when mail is selected', async () => {
    render(
      <PlaybookScheduleSheet
        open
        onOpenChange={vi.fn()}
        playbookId="p1"
        schedule={null}
        mailTrigger={{
          type: 'mail',
          enabled: true,
          available: true,
          config: {
            enabled: true,
            mailboxAppKey: 'microsoft',
            filters: {
              from: [],
              subjectContains: [],
              bodyContains: [],
              hasAttachments: null,
            },
            runtimeEnabled: false,
          },
        }}
      />,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'triggers.mailConfig.from' }), 'alerts@example.com');
    await userEvent.type(screen.getByRole('textbox', { name: 'triggers.mailConfig.subjectContains' }), 'invoice');
    await userEvent.type(screen.getByRole('textbox', { name: 'triggers.mailConfig.bodyContains' }), 'urgent');
    await userEvent.click(screen.getByRole('checkbox', { name: 'triggers.mailConfig.hasAttachments' }));
    await userEvent.click(screen.getByRole('button', { name: 'schedule.save' }));

    expect(storeMock.upsertPlaybookTriggerMail).toHaveBeenCalledWith('p1', {
      enabled: true,
      mailboxAppKey: 'microsoft',
      filters: {
        from: ['alerts@example.com'],
        subjectContains: ['invoice'],
        bodyContains: ['urgent'],
        hasAttachments: true,
      },
    });
  });
});
