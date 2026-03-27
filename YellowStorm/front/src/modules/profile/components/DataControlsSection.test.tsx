import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DataControlsSection } from './DataControlsSection';
import * as profileApi from '../api';

const updateDataSharingMock = vi.fn();
const exportDataMock = vi.fn();
const deleteAccountMock = vi.fn();

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({
    user: { consents: { dataSharing: false } },
    refreshUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('@/lib/use-api-action', () => ({
  useApiAction: (fn: unknown) => {
    if (fn === profileApi.updateDataSharing) {
      return { execute: updateDataSharingMock, isLoading: false };
    }
    if (fn === profileApi.exportData) {
      return { execute: exportDataMock, isLoading: false };
    }
    if (fn === profileApi.deleteAccount) {
      return { execute: deleteAccountMock, isLoading: false, error: null };
    }
    return { execute: vi.fn(), isLoading: false };
  },
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: vi.fn(),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
}));

vi.mock('@/components/ui/separator', () => ({ Separator: () => <div>sep</div> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ui/switch', () => ({
  Switch: ({ onCheckedChange }: { onCheckedChange?: (value: boolean) => void }) => (
    <button type="button" onClick={() => onCheckedChange?.(true)}>switch</button>
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

describe('DataControlsSection', () => {
  it('calls updateDataSharing when toggled', async () => {
    render(<DataControlsSection />);

    fireEvent.click(screen.getByText('switch'));

    await waitFor(() => {
      expect(updateDataSharingMock).toHaveBeenCalledWith(true);
    });
  });

  it('calls export and delete actions', async () => {
    render(<DataControlsSection />);

    fireEvent.click(screen.getByText('dataControls.export.button'));
    fireEvent.click(screen.getByText('dataControls.danger.confirm'));

    expect(exportDataMock).toHaveBeenCalled();
    expect(deleteAccountMock).toHaveBeenCalled();
  });
});
