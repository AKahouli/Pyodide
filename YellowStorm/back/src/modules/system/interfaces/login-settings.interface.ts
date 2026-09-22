export interface LoginSettings {
  accessExpiry: string;
  refreshExpiry: string;
}

export const DEFAULT_LOGIN_SETTINGS: LoginSettings = {
  accessExpiry: '3600m',
  refreshExpiry: '7d',
};

export const DEFAULT_ACCESS_EXPIRY_MS = 216_000_000;
export const DEFAULT_REFRESH_EXPIRY_MS = 604_800_000;

export function parseLoginExpiry(expiry: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(expiry);
  if (!match) return null;

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const milliseconds = Number(match[1]) * multipliers[match[2]];
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}
