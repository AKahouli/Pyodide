import { APP_DATA_ENVIRONMENTS, type AppDataEnvironment } from '../constants/app-data.constants';
import { AppDataErrorCode, AppDataException } from '../constants/app-data.errors';

export const APP_DATA_MAX_LIST_FILTERS = 25;

export function parseAppDataEnvironment(value: string): AppDataEnvironment {
  if ((APP_DATA_ENVIRONMENTS as readonly string[]).includes(value)) {
    return value as AppDataEnvironment;
  }
  throw new AppDataException(
    AppDataErrorCode.INVALID_MANIFEST,
    `Invalid environment: ${value}`,
  );
}

export function parsePositiveInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}
