import { parseLoginExpiry } from './login-settings.interface';

describe('parseLoginExpiry', () => {
  it('parses supported duration units and rejects malformed values', () => {
    expect(parseLoginExpiry('3600m')).toBe(216_000_000);
    expect(parseLoginExpiry('7d')).toBe(604_800_000);
    expect(parseLoginExpiry('7 days')).toBeNull();
  });
});
