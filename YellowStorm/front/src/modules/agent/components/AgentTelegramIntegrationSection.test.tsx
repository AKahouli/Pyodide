import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAgentTelegramIntegrationMock = vi.hoisted(() => vi.fn());
const upsertAgentTelegramIntegrationMock = vi.hoisted(() => vi.fn());
const deleteAgentTelegramIntegrationMock = vi.hoisted(() => vi.fn());
const showSuccessMock = vi.hoisted(() => vi.fn());
const showWarningMock = vi.hoisted(() => vi.fn());
const showInfoMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  getAgentTelegramIntegration: getAgentTelegramIntegrationMock,
  upsertAgentTelegramIntegration: upsertAgentTelegramIntegrationMock,
  deleteAgentTelegramIntegration: deleteAgentTelegramIntegrationMock,
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: showSuccessMock,
  showWarning: showWarningMock,
  showInfo: showInfoMock,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (options) {
        return `${key}:${Object.values(options).join(':')}`;
      }
      return key;
    },
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: { children: ReactNode }) => <button {...rest}>{children}</button>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    ...rest
  }: {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      data-testid="telegram-switch"
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...rest}
    />
  ),
}));

import { AgentTelegramIntegrationSection } from './AgentTelegramIntegrationSection';

describe('AgentTelegramIntegrationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a hint and disables the switch when no agentId is provided (create mode)', () => {
    render(<AgentTelegramIntegrationSection agentId={null} />);

    expect(screen.getByText('createEdit.fields.telegramRequiresAgent')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-switch')).toBeDisabled();
    expect(getAgentTelegramIntegrationMock).not.toHaveBeenCalled();
  });

  it('loads existing integration and pre-fills enabled state', async () => {
    getAgentTelegramIntegrationMock.mockResolvedValue({
      enabled: true,
      hasToken: true,
    });

    render(<AgentTelegramIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(getAgentTelegramIntegrationMock).toHaveBeenCalledWith('a1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('telegram-switch')).toBeChecked();
    });
    expect(
      screen.getByPlaceholderText('createEdit.fields.telegramBotTokenKeepPlaceholder'),
    ).toBeInTheDocument();
  });

  it('refuses to save when enabled is on, no token exists yet, and the input is empty', async () => {
    getAgentTelegramIntegrationMock.mockResolvedValue(null);

    render(<AgentTelegramIntegrationSection agentId="a1" />);

    await waitFor(() => expect(getAgentTelegramIntegrationMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('telegram-switch'));

    const saveButton = screen.getByText('createEdit.fields.telegramSave');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(
        screen.getByText('createEdit.fields.telegramBotTokenRequired'),
      ).toBeInTheDocument();
    });
    expect(upsertAgentTelegramIntegrationMock).not.toHaveBeenCalled();
  });

  it('upserts integration and shows webhook success feedback when backend registers webhook', async () => {
    getAgentTelegramIntegrationMock.mockResolvedValue(null);
    upsertAgentTelegramIntegrationMock.mockResolvedValue({
      enabled: true,
      hasToken: true,
      webhookRegistered: true,
      messageKey: 'webhook_success',
      botUsername: 'my_agent_bot',
      linkCode: 'AB12CD34',
      linkCodeExpiresAt: '2026-05-26T10:15:00.000Z',
    });

    render(<AgentTelegramIntegrationSection agentId="a1" />);

    await waitFor(() => expect(getAgentTelegramIntegrationMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('telegram-switch'));

    const tokenInput = screen.getByPlaceholderText(
      'createEdit.fields.telegramBotTokenPlaceholder',
    ) as HTMLInputElement;
    fireEvent.change(tokenInput, {
      target: { value: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' },
    });

    fireEvent.click(screen.getByText('createEdit.fields.telegramSave'));

    await waitFor(() => {
      expect(upsertAgentTelegramIntegrationMock).toHaveBeenCalledWith('a1', {
        enabled: true,
        botToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
      });
    });

    expect(showSuccessMock).toHaveBeenCalledWith(
      'createEdit.fields.telegramWebhookSuccess:my_agent_bot:AB12CD34',
    );
    expect(screen.getByText('createEdit.fields.telegramLinkInstructions')).toBeInTheDocument();
    expect(screen.getByText('createEdit.fields.telegramCopyLinkCommand')).toBeInTheDocument();
  });

  it('shows webhook failed warning when backend cannot register webhook', async () => {
    getAgentTelegramIntegrationMock.mockResolvedValue({
      enabled: true,
      hasToken: true,
    });
    upsertAgentTelegramIntegrationMock.mockResolvedValue({
      enabled: true,
      hasToken: true,
      webhookRegistered: false,
      messageKey: 'webhook_failed',
      errorMessage: 'HTTPS required',
    });

    render(<AgentTelegramIntegrationSection agentId="a1" />);

    await waitFor(() => expect(getAgentTelegramIntegrationMock).toHaveBeenCalled());
    fireEvent.click(screen.getByText('createEdit.fields.telegramSave'));

    await waitFor(() => {
      expect(showWarningMock).toHaveBeenCalledWith('createEdit.fields.telegramWebhookFailed', {
        description: 'HTTPS required',
      });
    });
  });

  it('removes the integration when Disconnect is clicked', async () => {
    getAgentTelegramIntegrationMock.mockResolvedValue({
      enabled: true,
      hasToken: true,
    });
    deleteAgentTelegramIntegrationMock.mockResolvedValue(undefined);

    render(<AgentTelegramIntegrationSection agentId="a1" />);

    await waitFor(() => expect(getAgentTelegramIntegrationMock).toHaveBeenCalled());

    fireEvent.click(await screen.findByText('createEdit.fields.telegramRemove'));

    await waitFor(() => {
      expect(deleteAgentTelegramIntegrationMock).toHaveBeenCalledWith('a1');
    });
    expect(showSuccessMock).toHaveBeenCalledWith('createEdit.fields.telegramRemoved');
  });
});
