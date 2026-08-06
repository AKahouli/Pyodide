import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalizationProvider } from './LocalizationProvider';

const i18nMock = vi.hoisted(() => {
  const listeners = new Map<string, Set<(value: never) => void>>();
  return {
    language: 'fr-FR',
    isInitialized: true,
    on: vi.fn((event: string, listener: (value: never) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    off: vi.fn((event: string, listener: (value: never) => void) => listeners.get(event)?.delete(listener)),
    emit: (event: string, value: unknown) => listeners.get(event)?.forEach((listener) => listener(value as never)),
    loadNamespaces: vi.fn().mockResolvedValue(undefined),
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    t: vi.fn((key: string) => key),
  };
});

vi.mock('./i18nInstance', () => ({ i18nInstance: i18nMock }));
vi.mock('react-i18next', () => ({ I18nextProvider: ({ children }: { children: ReactNode }) => children }));

describe('LocalizationProvider document language', () => {
  beforeEach(() => {
    document.documentElement.lang = 'en';
    i18nMock.language = 'fr-FR';
  });

  it('normalizes the initial language and keeps the document in sync', () => {
    render(<LocalizationProvider><div>content</div></LocalizationProvider>);
    expect(document.documentElement.lang).toBe('fr');

    act(() => i18nMock.emit('languageChanged', 'en-US'));
    expect(document.documentElement.lang).toBe('en');
  });
});
