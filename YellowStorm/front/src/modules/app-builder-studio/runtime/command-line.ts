import { ToolError } from './ToolError';
import { RuntimeErrorCodes } from './runtime.types';

/**
 * Nodepod spawns binaries directly — there is no shell. Models still write
 * shell-flavoured commands, so we parse the subset that can be honoured
 * (quoting, `&&`, `;`) and reject the rest loudly instead of forwarding
 * metacharacters as literal argv, which used to produce baffling errors like
 * `node -e` receiving a torn-apart script.
 */
export interface CommandStep {
  cmd: string;
  args: string[];
  /** Operator joining this step to the previous one; null for the first. */
  joinedBy: '&&' | ';' | null;
}

/** Constructs that need a real shell. Ordered so `&&` is matched before `&`. */
const UNSUPPORTED: ReadonlyArray<{ token: string; hint: string }> = [
  { token: '||', hint: 'run the fallback command separately' },
  { token: '|', hint: 'write the intermediate output to a file instead' },
  { token: '>>', hint: 'use the write tool' },
  { token: '>', hint: 'use the write tool' },
  { token: '<', hint: 'pass the file path as an argument' },
  { token: '$(', hint: 'run the inner command first and inline its result' },
  { token: '`', hint: 'run the inner command first and inline its result' },
  { token: '&', hint: 'background processes are not supported; use dev_server' },
];

function unsupported(token: string, hint: string, command: string): ToolError {
  return new ToolError(
    RuntimeErrorCodes.INVALID_PARAMS,
    `"${token}" needs a shell, and this runtime spawns binaries directly — ${hint}.`,
    { command, unsupported: token },
  );
}

function invalid(message: string, command: string): ToolError {
  return new ToolError(RuntimeErrorCodes.INVALID_PARAMS, message, { command });
}

/**
 * Split a command line into sequential steps.
 *
 * Supported: single and double quotes, backslash escapes, `&&` and `;`.
 * Not supported (and rejected): pipes, redirections, substitutions, globs,
 * variable expansion, background jobs.
 *
 * @throws ToolError `-32602` on an empty or shell-dependent command
 */
export function parseCommandLine(command: string): CommandStep[] {
  const steps: CommandStep[] = [];
  let tokens: string[] = [];
  let current = '';
  let hasCurrent = false;
  let joinedBy: CommandStep['joinedBy'] = null;

  const pushToken = () => {
    if (!hasCurrent) return;
    tokens.push(current);
    current = '';
    hasCurrent = false;
  };

  const pushStep = (operator: '&&' | ';') => {
    pushToken();
    if (tokens.length === 0) {
      throw invalid(`Empty command before "${operator}"`, command);
    }
    const [cmd, ...args] = tokens;
    steps.push({ cmd, args, joinedBy });
    tokens = [];
    joinedBy = operator;
  };

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (char === "'" || char === '"') {
      // Quotes only group characters; they never survive into argv.
      const closing = command.indexOf(char, i + 1);
      if (closing === -1) {
        throw invalid(`Unbalanced ${char} quote`, command);
      }
      current += command.slice(i + 1, closing);
      hasCurrent = true;
      i = closing;
      continue;
    }

    if (char === '\\' && i + 1 < command.length) {
      current += command[i + 1];
      hasCurrent = true;
      i += 1;
      continue;
    }

    if (char === '&' && command[i + 1] === '&') {
      pushStep('&&');
      i += 1;
      continue;
    }

    if (char === ';') {
      pushStep(';');
      continue;
    }

    if (/\s/.test(char)) {
      pushToken();
      continue;
    }

    const match = UNSUPPORTED.find((entry) => command.startsWith(entry.token, i));
    if (match) {
      throw unsupported(match.token, match.hint, command);
    }

    current += char;
    hasCurrent = true;
  }

  pushToken();
  if (tokens.length > 0) {
    const [cmd, ...args] = tokens;
    steps.push({ cmd, args, joinedBy });
  } else if (joinedBy !== null) {
    throw invalid(`Trailing "${joinedBy}" with no command after it`, command);
  }

  if (steps.length === 0) {
    throw invalid('command must not be empty', command);
  }

  return steps;
}
