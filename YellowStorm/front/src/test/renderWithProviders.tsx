import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LocalizationProvider } from '@/modules/localization';

type RenderWithProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
  router?: Pick<MemoryRouterProps, 'initialEntries' | 'initialIndex'>;
};

type TestProvidersProps = Readonly<{
  children: ReactNode;
  router?: RenderWithProvidersOptions['router'];
}>;

function TestProviders({ children, router }: TestProvidersProps) {
  return (
    <MemoryRouter {...router}>
      <LocalizationProvider>
        <ThemeProvider defaultTheme='light'>{children}</ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  );
}

export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  const { router, ...renderOptions } = options;

  return {
    user: userEvent.setup(),
    ...render(ui, {
      wrapper: ({ children }) => <TestProviders router={router}>{children}</TestProviders>,
      ...renderOptions,
    }),
  };
}

export * from '@testing-library/react';
