import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { LocalizationProvider } from '@/modules/localization';
import { connectWorkyWhatsApp, getWorkyWhatsAppSystemBotStatus } from '../api';
import { WorkyWhatsAppConnectModal } from './WorkyWhatsAppConnectModal';

vi.mock('../api', () => ({
  getWorkyWhatsAppIntegration: vi.fn().mockResolvedValue(null),
  getWorkyWhatsAppSystemBotStatus: vi.fn().mockResolvedValue({ connected: true }),
  connectWorkyWhatsApp: vi.fn(),
  getWorkyWhatsAppPairing: vi.fn(),
  disconnectWorkyWhatsAppSession: vi.fn(),
  deleteWorkyWhatsAppIntegration: vi.fn(),
  reconnectWorkyWhatsApp: vi.fn(),
}));

vi.mock('../hooks/useWorkyWhatsAppPairingSocket', () => ({
  useWorkyWhatsAppPairingSocket: vi.fn(),
}));

function renderModal(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LocalizationProvider>{ui}</LocalizationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkyWhatsAppConnectModal', () => {
  it('renders modal content when open', async () => {
    renderModal(<WorkyWhatsAppConnectModal open streamId='stream-1' onClose={vi.fn()} />);

    expect(await screen.findByTestId('worky-whatsapp-modal')).toBeInTheDocument();
    expect(screen.getByText('whatsapp.modalTitle')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    renderModal(<WorkyWhatsAppConnectModal open streamId='stream-1' onClose={onClose} />);

    fireEvent.click(await screen.findByTestId('worky-whatsapp-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows banner when system bot is offline', async () => {
    vi.mocked(getWorkyWhatsAppSystemBotStatus).mockResolvedValueOnce({ connected: false });

    renderModal(<WorkyWhatsAppConnectModal open streamId='stream-1' onClose={vi.fn()} />);

    expect(await screen.findByTestId('worky-whatsapp-system-bot-banner')).toBeInTheDocument();
    expect(screen.getByTestId('worky-whatsapp-connect')).toBeDisabled();
  });

  it('shows network error when connect fails with ERR_3219', async () => {
    vi.mocked(connectWorkyWhatsApp).mockRejectedValueOnce({
      code: 'ERR_3219',
      message: 'Cannot reach web.whatsapp.com from this server',
      statusCode: 400,
      method: 'POST',
      path: '/worky/streams/stream-1/whatsapp-integration/connect',
      requestId: 'req-1',
      timestamp: new Date().toISOString(),
    });

    renderModal(<WorkyWhatsAppConnectModal open streamId='stream-1' onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('worky-whatsapp-connect'));

    await waitFor(() => {
      expect(screen.getByTestId('worky-whatsapp-connect-error')).toHaveTextContent(
        'whatsapp.networkUnreachable',
      );
    });
  });
});
