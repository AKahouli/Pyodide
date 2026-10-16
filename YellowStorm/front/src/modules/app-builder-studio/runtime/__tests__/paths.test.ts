import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  toRelativePath,
  toVfsPath,
  validateListPath,
  validateToolPath,
  validateToolPathOptional,
} from '../paths';
import { ToolError } from '../ToolError';
import { RuntimeErrorCodes } from '../runtime.types';

function expectToolError(fn: () => unknown, code: number): ToolError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe(code);
    return err as ToolError;
  }
  throw new Error('Expected a ToolError to be thrown');
}

describe('normalizePath', () => {
  it.each([
    ['src/App.tsx', 'src/App.tsx'],
    ['src/./App.tsx', 'src/App.tsx'],
    ['src//components//Foo.tsx', 'src/components/Foo.tsx'],
    ['src/components/../App.tsx', 'src/App.tsx'],
    ['src\\components\\Foo.tsx', 'src/components/Foo.tsx'],
    ['a/../../b', '../b'],
    ['', '.'],
    ['a/..', '.'],
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('validateToolPath', () => {
  it('returns the normalized relative path', () => {
    expect(validateToolPath('src/./components/Foo.tsx')).toBe('src/components/Foo.tsx');
  });

  it.each(['', '   '])('rejects blank path %j with INVALID_PARAMS', (input) => {
    expectToolError(() => validateToolPath(input), RuntimeErrorCodes.INVALID_PARAMS);
  });

  it.each(['/etc/passwd', '\\windows\\system32', 'C:/Users/bader', 'C:\\Users\\bader'])(
    'rejects absolute path %s with SECURITY_DENIED',
    (input) => {
      const err = expectToolError(
        () => validateToolPath(input),
        RuntimeErrorCodes.SECURITY_DENIED,
      );
      expect(err.data).toMatchObject({ path: input, reason: 'absolute_path' });
    },
  );

  it.each(['../secrets.env', '../../etc/passwd', 'src/../../outside', '..\\..\\etc'])(
    'rejects traversal %s with SECURITY_DENIED',
    (input) => {
      const err = expectToolError(
        () => validateToolPath(input),
        RuntimeErrorCodes.SECURITY_DENIED,
      );
      expect(err.data).toMatchObject({ reason: 'path_traversal' });
    },
  );

  it('rejects null bytes with SECURITY_DENIED', () => {
    const err = expectToolError(
      () => validateToolPath('src/App\0.tsx'),
      RuntimeErrorCodes.SECURITY_DENIED,
    );
    expect(err.data).toMatchObject({ reason: 'null_byte' });
  });

  it('allows traversal that stays inside the workspace', () => {
    expect(validateToolPath('src/components/../App.tsx')).toBe('src/App.tsx');
  });
});

describe('validateToolPathOptional', () => {
  it('passes null and undefined through', () => {
    expect(validateToolPathOptional(null)).toBeNull();
    expect(validateToolPathOptional(undefined)).toBeNull();
  });

  it('still validates a provided path', () => {
    expectToolError(
      () => validateToolPathOptional('../nope'),
      RuntimeErrorCodes.SECURITY_DENIED,
    );
  });
});

describe('validateListPath', () => {
  it('short-circuits the workspace root', () => {
    expect(validateListPath('.')).toBe('.');
  });

  it('validates everything else', () => {
    expectToolError(() => validateListPath('/abs'), RuntimeErrorCodes.SECURITY_DENIED);
  });
});

describe('vfs path conversion', () => {
  it.each([
    ['.', '/'],
    ['', '/'],
    ['src', '/src'],
    ['src/App.tsx', '/src/App.tsx'],
  ])('toVfsPath(%j) -> %j', (input, expected) => {
    expect(toVfsPath(input)).toBe(expected);
  });

  it.each([
    ['/src/App.tsx', 'src/App.tsx'],
    ['/package.json', 'package.json'],
  ])('toRelativePath(%j) -> %j', (input, expected) => {
    expect(toRelativePath(input)).toBe(expected);
  });

  it('round-trips', () => {
    expect(toRelativePath(toVfsPath('src/App.tsx'))).toBe('src/App.tsx');
  });
});
