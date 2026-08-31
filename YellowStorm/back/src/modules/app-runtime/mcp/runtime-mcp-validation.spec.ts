import {
  resolveFinalizeRevision,
  validateToolPath,
} from './runtime-mcp-validation';
import { SecurityDeniedError } from './runtime-mcp.errors';

describe('runtime-mcp-validation', () => {
  it('normalizes relative paths', () => {
    expect(validateToolPath('src/App.jsx')).toBe('src/App.jsx');
    expect(validateToolPath('src\\App.jsx')).toBe('src/App.jsx');
  });

  it('blocks absolute and traversal paths', () => {
    expect(() => validateToolPath('/etc/passwd')).toThrow(SecurityDeniedError);
    expect(() => validateToolPath('../secret')).toThrow(SecurityDeniedError);
    expect(() => validateToolPath('src/../../secret')).toThrow(SecurityDeniedError);
  });

  it('coalesces stale finalize revision to latest', () => {
    expect(resolveFinalizeRevision(undefined, 'rev_2')).toBe('rev_2');
    expect(resolveFinalizeRevision('rev_1', 'rev_2')).toBe('rev_2');
    expect(resolveFinalizeRevision('rev_2', 'rev_2')).toBe('rev_2');
  });
});
