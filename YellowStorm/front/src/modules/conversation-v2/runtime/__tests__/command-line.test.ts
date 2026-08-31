import { describe, it, expect } from 'vitest';
import { parseCommandLine } from '../command-line';
import { ToolError } from '../ToolError';
import { RuntimeErrorCodes } from '../runtime.types';
import { preferCompleteOutput } from '../limits';

describe('parseCommandLine', () => {
  it('splits a simple command on spaces', () => {
    expect(parseCommandLine('npm run build')).toEqual([
      { cmd: 'npm', args: ['run', 'build'], joinedBy: null },
    ]);
  });

  it('keeps quoted arguments as a single argv entry', () => {
    expect(parseCommandLine(`node -e "console.log('hi')"`)).toEqual([
      { cmd: 'node', args: ['-e', "console.log('hi')"], joinedBy: null },
    ]);
  });

  it('splits on && and ;', () => {
    expect(parseCommandLine('cd src && npm run build')).toEqual([
      { cmd: 'cd', args: ['src'], joinedBy: null },
      { cmd: 'npm', args: ['run', 'build'], joinedBy: '&&' },
    ]);
    expect(parseCommandLine('echo a; echo b')).toEqual([
      { cmd: 'echo', args: ['a'], joinedBy: null },
      { cmd: 'echo', args: ['b'], joinedBy: ';' },
    ]);
  });

  it('rejects pipes, redirections and background jobs', () => {
    for (const command of ['ls | cat', 'echo hi > out', 'npm run dev &', 'echo $(pwd)']) {
      try {
        parseCommandLine(command);
        throw new Error(`expected a ToolError for ${command}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).code).toBe(RuntimeErrorCodes.INVALID_PARAMS);
      }
    }
  });

  it('rejects an empty command', () => {
    expect(() => parseCommandLine('   ')).toThrow(ToolError);
  });
});

describe('preferCompleteOutput', () => {
  it('keeps the longer completion payload over a partial stream', () => {
    const result = preferCompleteOutput(
      'vite v6 building for production...\n',
      'vite v6 building for production...\nbuilt in 1.23s\n',
    );
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('built in 1.23s');
  });

  it('keeps the stream when the completion payload is empty', () => {
    expect(preferCompleteOutput('hello', '').text).toBe('hello');
  });
});
