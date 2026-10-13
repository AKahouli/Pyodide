import { describe, expect, it } from 'vitest';
import {
  detectDevCommand,
  UnsupportedDevToolchainError,
  UNSUPPORTED_CRA_MESSAGE,
  UNSUPPORTED_NEXT_MESSAGE,
  unsupportedDevToolchainReason,
} from './dev-toolchain';

describe('unsupportedDevToolchainReason', () => {
  it('rejects Create React App (react-scripts)', () => {
    expect(
      unsupportedDevToolchainReason({
        scripts: { start: 'react-scripts start' },
        dependencies: { 'react-scripts': '5.0.1' },
      }),
    ).toBe(UNSUPPORTED_CRA_MESSAGE);
  });

  it('rejects Next.js', () => {
    expect(
      unsupportedDevToolchainReason({
        scripts: { dev: 'next dev' },
        dependencies: { next: '15.0.0' },
      }),
    ).toBe(UNSUPPORTED_NEXT_MESSAGE);
  });

  it('allows Vite React apps', () => {
    expect(
      unsupportedDevToolchainReason({
        scripts: { dev: 'vite', build: 'vite build' },
        devDependencies: { vite: '6.0.0' },
      }),
    ).toBeNull();
  });
});

describe('detectDevCommand', () => {
  it('prefers vite with --host', () => {
    expect(
      detectDevCommand({
        '/package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
      }),
    ).toEqual({ cmd: 'npm', args: ['run', 'dev', '--', '--host', '0.0.0.0'] });
  });

  it('rejects Create React App instead of falling back to npm start', () => {
    expect(() =>
      detectDevCommand({
        '/package.json': JSON.stringify({
          scripts: { start: 'react-scripts start' },
          dependencies: { 'react-scripts': '5.0.1' },
        }),
      }),
    ).toThrow(UnsupportedDevToolchainError);
    expect(() =>
      detectDevCommand({
        '/package.json': JSON.stringify({
          scripts: { start: 'react-scripts start' },
          dependencies: { 'react-scripts': '5.0.1' },
        }),
      }),
    ).toThrow(UNSUPPORTED_CRA_MESSAGE);
  });
});
