import { describe, it, expect } from 'vitest';
import { shouldReconnect } from './reconnectPolicy';

describe('shouldReconnect', () => {
  it('reconnects on abnormal close within budget', () => {
    expect(shouldReconnect(1006, 0, 5)).toBe(true);
  });
  it('reconnects after a goAway/normal close to continue the session', () => {
    expect(shouldReconnect(1000, 1, 5)).toBe(true);
  });
  it('stops after max attempts', () => {
    expect(shouldReconnect(1006, 5, 5)).toBe(false);
  });
  it('does not reconnect on auth failure (1008 policy violation)', () => {
    expect(shouldReconnect(1008, 0, 5)).toBe(false);
  });
});
