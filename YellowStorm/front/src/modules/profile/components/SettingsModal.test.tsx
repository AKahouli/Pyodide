import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';

const useSettingsModalMock = vi.hoisted(() => vi.fn());

vi.mock('../SettingsContext', () => ({
  useSettingsModal: useSettingsModalMock,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./SettingsSidebar', () => ({
  SettingsSidebar: () => <div>sidebar</div>,
}));

vi.mock('./ProfileSection', () => ({ ProfileSection: () => <div>profile-section</div> }));
vi.mock('./SessionsSection', () => ({ SessionsSection: () => <div>sessions-section</div> }));
vi.mock('./AppearanceSection', () => ({ AppearanceSection: () => <div>appearance-section</div> }));
vi.mock('./DataControlsSection', () => ({ DataControlsSection: () => <div>data-controls-section</div> }));
vi.mock('./HealthSection', () => ({ HealthSection: () => <div>health-section</div> }));
vi.mock('@/modules/usage', () => ({ UsageSection: () => <div>usage-section</div> }));

describe('SettingsModal', () => {
  it('renders active section content', () => {
    useSettingsModalMock.mockReturnValue({
      isOpen: true,
      closeSettings: vi.fn(),
      activeSection: 'sessions',
      setActiveSection: vi.fn(),
    });

    render(<SettingsModal />);

    expect(screen.getByText('sidebar')).toBeInTheDocument();
    expect(screen.getByText('sessions-section')).toBeInTheDocument();
  });
});
