import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '@/lib/error-codes';

const getAgentWhatsAppIntegrationMock = vi.hoisted(() => vi.fn());
const connectAgentWhatsAppMock = vi.hoisted(() => vi.fn());
const getAgentWhatsAppPairingMock = vi.hoisted(() => vi.fn());
const disconnectAgentWhatsAppSessionMock = vi.hoisted(() => vi.fn());
const deleteAgentWhatsAppIntegrationMock = vi.hoisted(() => vi.fn());
const reconnectAgentWhatsAppMock = vi.hoisted(() => vi.fn());
const notifyAgentWhatsAppAutoRecoverMock = vi.hoisted(() => vi.fn());
const updateAgentWhatsAppEnabledMock = vi.hoisted(() => vi.fn());
const useWhatsAppIntegrationSseMock = vi.hoisted(() => vi.fn());
const useWhatsAppPairingSocketMock = vi.hoisted(() => vi.fn());
const showSuccessMock = vi.hoisted(() => vi.fn());
const showWarningMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  getAgentWhatsAppIntegration: getAgentWhatsAppIntegrationMock,
  connectAgentWhatsApp: connectAgentWhatsAppMock,
  getAgentWhatsAppPairing: getAgentWhatsAppPairingMock,
  disconnectAgentWhatsAppSession: disconnectAgentWhatsAppSessionMock,
  deleteAgentWhatsAppIntegration: deleteAgentWhatsAppIntegrationMock,
  reconnectAgentWhatsApp: reconnectAgentWhatsAppMock,
  notifyAgentWhatsAppAutoRecover: notifyAgentWhatsAppAutoRecoverMock,
  updateAgentWhatsAppEnabled: updateAgentWhatsAppEnabledMock,
}));

vi.mock('../hooks/useWhatsAppPairingSocket', () => ({
  useWhatsAppPairingSocket: useWhatsAppPairingSocketMock,
}));

vi.mock('../hooks/useWhatsAppIntegrationSse', () => ({
  useWhatsAppIntegrationSse: useWhatsAppIntegrationSseMock,
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: showSuccessMock,
  showWarning: showWarningMock,
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

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

import { AgentWhatsAppIntegrationSection } from './AgentWhatsAppIntegrationSection';

describe('AgentWhatsAppIntegrationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAgentWhatsAppIntegrationMock.mockResolvedValue(null);
    notifyAgentWhatsAppAutoRecoverMock.mockResolvedValue({ enabled: true, status: 'FAILED' });
    useWhatsAppIntegrationSseMock.mockImplementation(() => undefined);
    useWhatsAppPairingSocketMock.mockImplementation(() => undefined);
  });

  it('shows requires-agent hint when agentId is null', () => {
    render(<AgentWhatsAppIntegrationSection agentId={null} />);

    expect(screen.getByText('createEdit.fields.whatsappRequiresAgent')).toBeInTheDocument();
    expect(getAgentWhatsAppIntegrationMock).not.toHaveBeenCalled();
  });

  it('loads integration and shows connect when disconnected', async () => {
    getAgentWhatsAppIntegrationMock.mockResolvedValue({ enabled: true, status: 'DISCONNECTED' });

    render(<AgentWhatsAppIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(getAgentWhatsAppIntegrationMock).toHaveBeenCalledWith('a1');
    });

    expect(screen.getByTestId('whatsapp-connect')).toBeInTheDocument();
    expect(screen.getByText('createEdit.fields.whatsappStatusNotConnected')).toBeInTheDocument();
  });

  it('hides connect until the toggle is switched on for a new integration', async () => {
    render(<AgentWhatsAppIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(getAgentWhatsAppIntegrationMock).toHaveBeenCalledWith('a1');
    });

    expect(screen.queryByTestId('whatsapp-connect')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('whatsapp-enabled-switch'));

    expect(screen.getByTestId('whatsapp-connect')).toBeInTheDocument();
    expect(updateAgentWhatsAppEnabledMock).not.toHaveBeenCalled();
  });

  it('shows pairing UI when status is PAIRING', async () => {
    getAgentWhatsAppIntegrationMock.mockResolvedValue({
      enabled: true,
      status: 'PAIRING',
      sessionId: 'sess-1',
    });

    render(<AgentWhatsAppIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(screen.getByText('createEdit.fields.whatsappStatusPairing')).toBeInTheDocument();
    });

    expect(screen.getByTestId('whatsapp-refresh')).toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-cancel')).toBeInTheDocument();
  });

  it('refreshes integration when pairing endpoint returns not-pairing', async () => {
    getAgentWhatsAppIntegrationMock
      .mockResolvedValueOnce({
        status: 'PAIRING',
        sessionId: 'sess-1',
      })
      .mockResolvedValueOnce({
        status: 'CONNECTED',
        sessionId: 'sess-1',
        phoneNumber: '+216 12 345 678',
        displayName: 'John Doe',
      });

    getAgentWhatsAppPairingMock.mockRejectedValue({
      code: ErrorCode.WHATSAPP_SESSION_NOT_PAIRING,
      message: 'WhatsApp session is not in pairing state',
      statusCode: 400,
      method: 'GET',
      path: '/api/v1/agents/a1/whatsapp-integration/sess-1/pairing',
      timestamp: '2026-07-08T14:04:44.802Z',
      requestId: 'req-1',
    });

    render(<AgentWhatsAppIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(screen.getByText('createEdit.fields.whatsappStatusPairing')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('createEdit.fields.whatsappStatusConnected')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('whatsapp-refresh')).not.toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-disconnect')).toBeInTheDocument();
    expect(getAgentWhatsAppIntegrationMock).toHaveBeenCalledWith('a1');
    expect(getAgentWhatsAppIntegrationMock).toHaveBeenCalledTimes(2);
  });

  it('starts pairing on connect click', async () => {
    getAgentWhatsAppIntegrationMock.mockResolvedValue({ enabled: true, status: 'DISCONNECTED' });
    getAgentWhatsAppPairingMock.mockResolvedValue({});
    connectAgentWhatsAppMock.mockResolvedValue({
      sessionId: 'sess-2',
      status: 'PAIRING',
      qrCode: 'abc123',
      pairingCode: '12345678',
    });

    render(<AgentWhatsAppIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(getAgentWhatsAppIntegrationMock).toHaveBeenCalledWith('a1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('whatsapp-connect')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('whatsapp-connect'));

    await waitFor(() => {
      expect(connectAgentWhatsAppMock).toHaveBeenCalledWith('a1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('whatsapp-qr')).toBeInTheDocument();
    });
  });

  it('shows connected phone and agent name', async () => {
    getAgentWhatsAppIntegrationMock.mockResolvedValue({
      enabled: true,
      status: 'CONNECTED',
      sessionId: 'sess-3',
      phoneNumber: '+216 12 345 678',
      displayName: 'John Doe',
    });

    render(<AgentWhatsAppIntegrationSection agentId="a1" agentName="Support Bot" />);

    await waitFor(() => {
      expect(screen.getByText('createEdit.fields.whatsappStatusConnected')).toBeInTheDocument();
    });

    expect(screen.getByText('+216 12 345 678')).toBeInTheDocument();
    expect(screen.getByText('Support Bot')).toBeInTheDocument();
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-disconnect')).toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-reconnect')).toBeInTheDocument();
  });

  it('toggles whatsapp availability for an existing integration', async () => {
    getAgentWhatsAppIntegrationMock.mockResolvedValue({
      enabled: true,
      status: 'CONNECTED',
      sessionId: 'sess-4',
    });
    updateAgentWhatsAppEnabledMock.mockResolvedValue({
      enabled: false,
      status: 'CONNECTED',
      sessionId: 'sess-4',
    });

    render(<AgentWhatsAppIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(screen.getByTestId('whatsapp-enabled-switch')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('whatsapp-enabled-switch'));

    await waitFor(() => {
      expect(updateAgentWhatsAppEnabledMock).toHaveBeenCalledWith('a1', { enabled: false });
    });
  });

  it('requests auto-recover and listens for recovery events when FAILED', async () => {
    getAgentWhatsAppIntegrationMock.mockResolvedValue({
      enabled: true,
      status: 'FAILED',
      sessionId: 'sess-failed',
      errorMessage: 'Connection closed',
    });

    render(<AgentWhatsAppIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(notifyAgentWhatsAppAutoRecoverMock).toHaveBeenCalledWith('a1');
    });

    expect(useWhatsAppIntegrationSseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'a1',
        enabled: true,
      }),
    );
    expect(useWhatsAppPairingSocketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'a1',
        sessionId: 'sess-failed',
        enabled: true,
      }),
    );
  });

  it('updates status to CONNECTED when SSE reports recovery success', async () => {
    getAgentWhatsAppIntegrationMock.mockResolvedValue({
      enabled: true,
      status: 'FAILED',
      sessionId: 'sess-failed',
      errorMessage: 'Connection closed',
    });

    let emitStatus: ((integration: {
      enabled: boolean;
      status: 'CONNECTED';
      sessionId: string;
      phoneNumber: string;
    }) => void) | undefined;
    useWhatsAppIntegrationSseMock.mockImplementation(({ onStatus }) => {
      emitStatus = onStatus;
      return undefined;
    });

    render(<AgentWhatsAppIntegrationSection agentId="a1" />);

    await waitFor(() => {
      expect(emitStatus).toBeDefined();
    });

    emitStatus?.({
      enabled: true,
      status: 'CONNECTED',
      sessionId: 'sess-failed',
      phoneNumber: '+21655239397',
    });

    await waitFor(() => {
      expect(screen.getByText('createEdit.fields.whatsappStatusConnected')).toBeInTheDocument();
    });

    expect(showSuccessMock).toHaveBeenCalledWith('createEdit.fields.whatsappConnected');
    expect(screen.getByText('+21655239397')).toBeInTheDocument();
  });
});
