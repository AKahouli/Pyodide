import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('triggers.automated.mailStatusSetup')).toBeInTheDocument();
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
            notificationUrl: null,
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

  it('syncs the Microsoft 365 subscription from the trigger panel', async () => {
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

    await userEvent.type(
      screen.getByRole('textbox', { name: 'triggers.mailConfig.notificationUrl' }),
      'https://example.test/webhook',
    );
    await userEvent.click(screen.getByRole('button', { name: 'triggers.mailConfig.syncSubscription' }));

    expect(storeMock.syncPlaybookTriggerMailSubscription).toHaveBeenCalledWith('p1', {
      notificationUrl: 'https://example.test/webhook',
    });
  });
});
