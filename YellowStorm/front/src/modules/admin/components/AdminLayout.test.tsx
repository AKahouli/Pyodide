import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminLayout } from './AdminLayout';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./AdminSidebar', () => ({
  AdminSidebar: () => <div>admin-sidebar</div>,
}));

vi.mock('@/components/mode-toggle', () => ({
  ModeToggle: () => <div>mode-toggle</div>,
}));

vi.mock('react-router-dom', () => ({
  Outlet: () => <div>layout-outlet</div>,
}));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTriggerMobile: () => <button type='button'>mobile-trigger</button>,
}));

describe('AdminLayout', () => {
  it('renders sidebar, header label and outlet', () => {
    render(<AdminLayout />);
    expect(screen.getByText('admin-sidebar')).toBeInTheDocument();
    expect(screen.getByText('layout.header')).toBeInTheDocument();
    expect(screen.getByText('layout-outlet')).toBeInTheDocument();
  });
});
