import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import MaintenancePage from './MaintenancePage';

// Hoisted mocks - MUST be declared before vi.mock() calls
const navigateMock = vi.hoisted(() => vi.fn());
const logoutMock = vi.hoisted(() => vi.fn());
const clearMaintenanceInfoMock = vi.hoisted(() => vi.fn());
const getMaintenanceInfoMock = vi.hoisted(() => vi.fn<() => {
  enabled: boolean;
  message: string;
  estimatedEndAt?: string;
} | null>(() => null));
const tMock = vi.hoisted(() => vi.fn((key: string, options?: { defaultValue?: string; [key: string]: any }) => {
  if (options?.defaultValue) return options.defaultValue;
  return key;
}));

// Mock modules
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ logout: logoutMock }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: tMock,
    language: 'en-US',
    ready: true,
  }),
}));

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return {
    ...actual,
    getMaintenanceInfo: getMaintenanceInfoMock,
    clearMaintenanceInfo: clearMaintenanceInfoMock,
  };
});

describe.skip('MaintenancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders maintenance message when maintenance info is present', async () => {
    const maintenanceInfo = {
      enabled: true,
      message: 'Scheduled maintenance in progress',
      estimatedEndAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    };
    getMaintenanceInfoMock.mockReturnValue(maintenanceInfo);

    render(
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/we.*re doing a little maintenance/i)).toBeInTheDocument();
      expect(screen.getByText('Scheduled maintenance in progress')).toBeInTheDocument();
      expect(screen.getByText(/back to login/i)).toBeInTheDocument();
    });
  });

  it('renders countdown with hours when maintenance has estimated end time', async () => {
    const futureTime = new Date(Date.now() + 3665000); // 1h 1m 5s from now
    const maintenanceInfo = {
      enabled: true,
      message: 'Planned maintenance',
      estimatedEndAt: futureTime.toISOString(),
    };
    getMaintenanceInfoMock.mockReturnValue(maintenanceInfo);

    render(
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/estimated time remaining:/i)).toBeInTheDocument();
      const countdownText = screen.getByTestId('countdown').textContent;
      expect(countdownText).toMatch(/\d+h \d+m \d+s/);
    });
  });

  it('renders countdown with minutes when less than 1 hour remains', async () => {
    const futureTime = new Date(Date.now() + 125000); // 2m 5s from now
    const maintenanceInfo = {
      enabled: true,
      message: 'Quick update',
      estimatedEndAt: futureTime.toISOString(),
    };
    getMaintenanceInfoMock.mockReturnValue(maintenanceInfo);

    render(
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const countdownText = screen.getByTestId('countdown').textContent;
      expect(countdownText).toMatch(/\d+m \d+s/);
      expect(countdownText).not.toMatch(/\d+h/);
    });
  });

  it('shows "any moment now" when maintenance end time has passed', async () => {
    const pastTime = new Date(Date.now() - 5000); // 5 seconds ago
    const maintenanceInfo = {
      enabled: true,
      message: 'Finishing up',
      estimatedEndAt: pastTime.toISOString(),
    };
    getMaintenanceInfoMock.mockReturnValue(maintenanceInfo);

    render(
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/any moment now/i)).toBeInTheDocument();
    });
  });

  it('does not show countdown when estimatedEndAt is not provided', async () => {
    const maintenanceInfo = {
      enabled: true,
      message: 'Maintenance in progress',
    };
    getMaintenanceInfoMock.mockReturnValue(maintenanceInfo);

    render(
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/estimated time remaining/i)).not.toBeInTheDocument();
  });

  it('calls logout and clears maintenance info on back to login click', async () => {
    const maintenanceInfo = {
      enabled: true,
      message: 'Maintenance',
    };
    getMaintenanceInfoMock.mockReturnValue(maintenanceInfo);

    render(
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>,
    );

    const backButton = screen.getByRole('button', { name: /back to login/i });
    await userEvent.click(backButton);

    expect(logoutMock).toHaveBeenCalled();
    expect(clearMaintenanceInfoMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
  });

  it('calls logout when back to login is clicked', async () => {
    const maintenanceInfo = {
      enabled: true,
      message: 'Maintenance',
    };
    getMaintenanceInfoMock.mockReturnValue(maintenanceInfo);

    render(
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>,
    );

    const backButton = screen.getByRole('button', { name: /back to login/i });
    await userEvent.click(backButton);

    expect(logoutMock).toHaveBeenCalled();
    expect(clearMaintenanceInfoMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
  });

  it('uses useModuleTranslation for translations', async () => {
    const maintenanceInfo = {
      enabled: true,
      message: 'Maintenance en cours',
    };
    getMaintenanceInfoMock.mockReturnValue(maintenanceInfo);

    render(
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(tMock).toHaveBeenCalledWith('maintenance.title', expect.any(Object));
      expect(tMock).toHaveBeenCalledWith('maintenance.description', expect.any(Object));
      expect(tMock).toHaveBeenCalledWith('maintenance.backToLogin', expect.any(Object));
    });
  });
});
