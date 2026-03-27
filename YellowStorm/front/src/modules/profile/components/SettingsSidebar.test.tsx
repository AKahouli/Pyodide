import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from './SettingsSidebar';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <div>sep</div>,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

describe('SettingsSidebar', () => {
  it('renders nav items and triggers selection', () => {
    const onSelect = vi.fn();
    render(<SettingsSidebar activeSection="profile" onSelect={onSelect} />);

    const profileButton = screen.getByText('settings.nav.profile');
    fireEvent.click(profileButton);

    expect(onSelect).toHaveBeenCalledWith('profile');
  });
});
