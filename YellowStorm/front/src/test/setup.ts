import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

type RouteParams = Record<string, string | undefined>;

const routeParamsState = { current: {} as RouteParams };

export const mockNavigate = vi.fn();

export function setMockRouteParams(params: RouteParams) {
  routeParamsState.current = params;
}

export const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  request: vi.fn(),
};

if (!globalThis.matchMedia) {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

if (!globalThis.ResizeObserver) {
  class ResizeObserverMock {
    observe = vi.fn();

    unobserve = vi.fn();

    disconnect = vi.fn();
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverMock,
  });
}

if (
  typeof Element !== 'undefined'
  && !Element.prototype.scrollIntoView
) {
  Element.prototype.scrollIntoView = vi.fn();
}

if (
  typeof HTMLElement !== 'undefined'
  && !HTMLElement.prototype.hasPointerCapture
) {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
}

if (
  !globalThis.localStorage
  || typeof globalThis.localStorage.getItem !== 'function'
  || typeof globalThis.localStorage.setItem !== 'function'
) {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    writable: true,
    configurable: true,
    value: {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    } satisfies Storage,
  });
}

vi.mock('i18next', async () => {
  const actual = await vi.importActual<typeof import('i18next')>('i18next');
  return {
    ...actual,
    default: {
      ...actual.default,
      t: (key: string) => key,
    },
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: {
        language: 'en',
        changeLanguage: vi.fn(async () => undefined),
      },
      ready: true,
    }),
  };
});

vi.mock('@/modules/localization', async () => {
  const actual = await vi.importActual<typeof import('@/modules/localization')>('@/modules/localization');

  return {
    ...actual,
    useModuleTranslation: () => ({
      t: (key: string) => key,
      language: 'en',
      ready: true,
    }),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => routeParamsState.current,
  };
});

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return {
    ...actual,
    apiClient: mockApiClient,
  };
});

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');

  return {
    ...actual,
    apiClient: mockApiClient,
    default: mockApiClient,
  };
});

afterEach(() => {
  cleanup();
  routeParamsState.current = {};
  mockNavigate.mockReset();
  Object.values(mockApiClient).forEach((fn) => fn.mockReset());
});
