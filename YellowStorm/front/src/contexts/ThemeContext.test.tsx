import { useContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, ThemeProviderContext, type ColorTheme } from './ThemeContext';

const useAuthMock = vi.hoisted(() => {
  const user = { id: 'admin', appearance: { colorTheme: 'default' as ColorTheme } };
  return vi.fn(() => ({
    isAuthenticated: true,
    user,
  }));
});

vi.mock('@/modules/auth', () => ({
  useAuth: () => useAuthMock(),
}));

function ThemeProbe() {
  const { colorTheme, setColorTheme } = useContext(ThemeProviderContext);
  return (
    <>
      <div data-testid='color-theme'>{colorTheme}</div>
      <button type='button' onClick={() => setColorTheme('yellow')}>
        apply-yellow
      </button>
    </>
  );
}

describe('ThemeProvider', () => {
  const defaultUser = { id: 'admin', appearance: { colorTheme: 'default' as ColorTheme } };

  beforeEach(() => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      user: defaultUser,
    });
    document.documentElement.className = '';
  });

  it('keeps a live color theme when the global default updates before /me refreshes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ThemeProvider defaultColorTheme='default'>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('color-theme')).toHaveTextContent('default');
    await user.click(screen.getByRole('button', { name: 'apply-yellow' }));
    expect(screen.getByTestId('color-theme')).toHaveTextContent('yellow');
    expect(document.documentElement.classList.contains('theme-yellowsys')).toBe(true);

    rerender(
      <ThemeProvider defaultColorTheme='yellow'>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('color-theme')).toHaveTextContent('yellow');
    expect(document.documentElement.classList.contains('theme-yellowsys')).toBe(true);
  });

  it('follows the user profile when /me returns a new color theme', () => {
    const { rerender } = render(
      <ThemeProvider defaultColorTheme='default'>
        <ThemeProbe />
      </ThemeProvider>,
    );

    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'admin', appearance: { colorTheme: 'orange' } },
    });
    rerender(
      <ThemeProvider defaultColorTheme='orange'>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('color-theme')).toHaveTextContent('orange');
    expect(document.documentElement.classList.contains('theme-claude')).toBe(true);
  });
});
