import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlaybookScheduleSheet } from './PlaybookScheduleSheet';

const storeMock = vi.hoisted(() => ({
  upsertPlaybookTriggerSchedule: vi.fn(),
  clearPlaybookTriggerSchedule: vi.fn(),
  upsertPlaybookTriggerMail: vi.fn(),
  clearPlaybookTriggerMail: vi.fn(),
  syncPlaybookTriggerMailSubscription: vi.fn(),
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
  fetch: vi.fn(async () => undefined),
}));

vi.mock('@/modules/connected-app/store', () => ({
  useConnectedAppStore: (selector: (state: {
    fetchMailboxCapability: typeof mailboxCapabilityMock.fetch;
    mailboxCapability: typeof mailboxCapabilityMock.current;
  }) => unknown) => selector({
    fetchMailboxCapability: mailboxCapabilityMock.fetch,
    mailboxCapability: mailboxCapabilityMock.current,
  }),
  useMailboxCapability: () => mailboxCapabilityMock.current,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

const localEndOfDayIso = (year: number, monthIndex: number, day: number): string =>
  new Date(year, monthIndex, day, 23, 59, 59, 999).toISOString();

describe('PlaybookScheduleSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.triggerSaving = false;
    mailboxCapabilityMock.current = null;
    mailboxCapabilityMock.fetch.mockResolvedValue(undefined);
  });

  it('shows manual trigger and hides schedule editors when no automated trigger is selected', async () => {
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
    expect(await screen.findByText('triggers.automated.mailStatusSetup')).toBeInTheDocument();
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

    await userEvent.click(screen.getByText('triggers.automated.scheduleTitle'));

    expect(screen.getByText('schedule.mode')).toBeInTheDocument();
  });

  it('reveals mail controls when mail is selected from the visible card', async () => {
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

    await userEvent.click(screen.getByText('triggers.automated.mailTitle'));

    expect(screen.getByRole('textbox', { name: 'triggers.mailConfig.notificationUrl' })).toBeInTheDocument();
  });

  it('keeps a selected mail trigger when mailbox capability or trigger props refresh', async () => {
    const props = { open: true, onOpenChange: vi.fn(), playbookId: 'p1', schedule: null };
    const { rerender } = render(<PlaybookScheduleSheet {...props} />);
    await userEvent.click(screen.getByRole('radio', { name: /triggers.automated.mailTitle/ }));
    mailboxCapabilityMock.current = {
      connected: true, mailboxReady: true, missingScopes: [], grantedScopes: ['mail.read'],
    };
    rerender(<PlaybookScheduleSheet {...props} mailTrigger={null} />);

    expect(screen.getByRole('radio', { name: /triggers.automated.mailTitle/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'schedule.save' }));
    expect(storeMock.upsertPlaybookTriggerMail).toHaveBeenCalledWith('p1', expect.objectContaining({ enabled: true }));
    expect(storeMock.upsertPlaybookTriggerSchedule).not.toHaveBeenCalled();
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

  it('shows mailbox readiness hint for future mail trigger support', async () => {
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

    expect(await screen.findByText('triggers.automated.mailReady')).toBeInTheDocument();
  });

  it('shows missing mailbox scopes hint when mail permissions are incomplete', async () => {
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

    expect(await screen.findByText('triggers.automated.mailScopesMissing')).toBeInTheDocument();
  });

  it('saves mail trigger filters when mail is selected', async () => {
    const user = userEvent.setup({ delay: null });
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
            notificationUrl: null,
            autoRenewUntil: null,
            attachmentImportEnabled: false,
            allowedAttachmentExtensions: [],
            filters: {
              from: [],
              subjectContains: [],
              bodyContains: [],
              hasAttachments: null,
            },
            runtimeEnabled: false,
            subscriptionId: null,
            subscriptionClientState: null,
            subscriptionExpiresAt: null,
            runtimePayloadSchema: null,
          },
        }}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'triggers.mailConfig.from' }), 'alerts@example.com');
    await user.type(screen.getByRole('textbox', { name: 'triggers.mailConfig.subjectContains' }), 'invoice');
    await user.type(screen.getByRole('textbox', { name: 'triggers.mailConfig.bodyContains' }), 'urgent');
    fireEvent.change(screen.getByLabelText('triggers.mailConfig.autoRenewUntil'), {
      target: { value: '2026-05-01' },
    });
    await user.click(screen.getByRole('checkbox', { name: 'triggers.mailConfig.hasAttachments' }));
    await user.click(screen.getByRole('button', { name: 'schedule.save' }));

    expect(storeMock.upsertPlaybookTriggerMail).toHaveBeenCalledWith('p1', {
      enabled: true,
      mailboxAppKey: 'microsoft',
      autoRenewUntil: localEndOfDayIso(2026, 4, 1),
      attachmentImportEnabled: false,
      allowedAttachmentExtensions: [],
      filters: {
        from: ['alerts@example.com'],
        subjectContains: ['invoice'],
        bodyContains: ['urgent'],
        hasAttachments: true,
      },
    });
  });

  it('serializes an unchecked hasAttachments filter as false', async () => {
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
            notificationUrl: null,
            autoRenewUntil: null,
            attachmentImportEnabled: true,
            allowedAttachmentExtensions: ['pptx'],
            filters: {
              from: [],
              subjectContains: [],
              bodyContains: [],
              hasAttachments: null,
            },
            runtimeEnabled: false,
            subscriptionId: null,
            subscriptionClientState: null,
            subscriptionExpiresAt: null,
            runtimePayloadSchema: null,
          },
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'schedule.save' }));

    expect(storeMock.upsertPlaybookTriggerMail).toHaveBeenCalledWith('p1', {
      enabled: true,
      mailboxAppKey: 'microsoft',
      autoRenewUntil: null,
      attachmentImportEnabled: true,
      allowedAttachmentExtensions: ['pptx'],
      filters: {
        from: [],
        subjectContains: [],
        bodyContains: [],
        hasAttachments: false,
      },
    });
  });

  it('syncs the Microsoft 365 subscription from the trigger panel', async () => {
    const user = userEvent.setup({ delay: null });
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
        mailTrigger={{
          type: 'mail',
          enabled: true,
          available: true,
          config: {
            enabled: true,
            mailboxAppKey: 'microsoft',
            notificationUrl: null,
            autoRenewUntil: null,
            attachmentImportEnabled: false,
            allowedAttachmentExtensions: [],
            filters: {
              from: [],
              subjectContains: [],
              bodyContains: [],
              hasAttachments: null,
            },
            runtimeEnabled: false,
            subscriptionId: null,
            subscriptionClientState: null,
            subscriptionExpiresAt: null,
            runtimePayloadSchema: null,
          },
        }}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'triggers.mailConfig.notificationUrl' }),
      'https://example.test/webhook',
    );
    fireEvent.change(screen.getByLabelText('triggers.mailConfig.autoRenewUntil'), {
      target: { value: '2026-05-01' },
    });
    await user.click(screen.getByRole('button', { name: 'triggers.mailConfig.syncSubscription' }));

    expect(storeMock.syncPlaybookTriggerMailSubscription).toHaveBeenCalledWith('p1', {
      notificationUrl: 'https://example.test/webhook',
      autoRenewUntil: localEndOfDayIso(2026, 4, 1),
    });
  });
});
