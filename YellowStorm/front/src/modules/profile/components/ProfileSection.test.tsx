import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileSection } from './ProfileSection';

const updateProfileMock = vi.fn();
const refreshUserMock = vi.fn();

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({
    user: { email: 'test@example.com', profile: { firstName: 'Jane', lastName: 'Doe', company: 'ACME' } },
    refreshUser: refreshUserMock,
  }),
}));

vi.mock('@/lib/use-api-action', () => ({
  useApiAction: () => ({ execute: updateProfileMock, isLoading: false }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-hook-form', () => ({
  useForm: () => ({
    control: {},
    handleSubmit: (fn: (values: any) => void) => (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.();
      return fn({ firstName: 'Jane', lastName: 'Doe', company: 'ACME' });
    },
    reset: vi.fn(),
  }),
}));

vi.mock('@/components/ui/form', () => ({
  Form: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormControl: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormField: ({ render }: { render: (props: any) => ReactNode }) => render({ field: { name: 'field', value: '', onChange: vi.fn() } }),
  FormItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormLabel: ({ children }: { children: ReactNode }) => <label>{children}</label>,
  FormMessage: () => <div />,
  FormDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: { children: ReactNode }) => <button {...rest}>{children}</button>,
}));

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <div>sep</div>,
}));

describe('ProfileSection', () => {
  it('renders email and submits profile updates', () => {
    render(<ProfileSection />);

    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByText('profileSection.actions.save'));

    expect(updateProfileMock).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'ACME',
    });
  });
});
