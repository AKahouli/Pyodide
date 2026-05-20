import {
  FileTextIcon,
  GlobeIcon,
  MessageSquareIcon,
  SearchIcon,
  TerminalIcon,
  PuzzleIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react';

/** Human-readable label per tool function, mirrors Manus' TOOL_FUNCTION_MAP. */
export const TOOL_FUNCTION_LABEL: Record<string, string> = {
  shell_exec: 'Executing command',
  shell_view: 'Viewing command output',
  shell_wait: 'Waiting for command',
  shell_write_to_process: 'Writing to process',
  shell_kill_process: 'Terminating process',

  file_read: 'Reading file',
  file_write: 'Writing file',
  file_str_replace: 'Replacing file content',
  file_find_in_content: 'Searching file content',
  file_find_by_name: 'Finding file',

  browser_view: 'Viewing webpage',
  browser_navigate: 'Navigating to webpage',
  browser_restart: 'Restarting browser',
  browser_click: 'Clicking element',
  browser_input: 'Entering text',
  browser_move_mouse: 'Moving mouse',
  browser_press_key: 'Pressing key',
  browser_select_option: 'Selecting option',
  browser_scroll_up: 'Scrolling up',
  browser_scroll_down: 'Scrolling down',
  browser_console_exec: 'Executing JS code',
  browser_console_view: 'Viewing console output',

  info_search_web: 'Searching web',

  message_notify_user: 'Sending notification',
  message_ask_user: 'Asking question',
};

/** Which arg to surface next to the label, mirrors Manus' TOOL_FUNCTION_ARG_MAP. */
export const TOOL_FUNCTION_ARG_KEY: Record<string, string> = {
  shell_exec: 'command',
  shell_view: 'shell',
  shell_wait: 'shell',
  shell_write_to_process: 'input',
  shell_kill_process: 'shell',
  file_read: 'file',
  file_write: 'file',
  file_str_replace: 'file',
  file_find_in_content: 'file',
  file_find_by_name: 'path',
  browser_view: 'page',
  browser_navigate: 'url',
  browser_restart: 'url',
  browser_click: 'element',
  browser_input: 'text',
  browser_move_mouse: 'position',
  browser_press_key: 'key',
  browser_select_option: 'option',
  browser_scroll_up: 'page',
  browser_scroll_down: 'page',
  browser_console_exec: 'code',
  browser_console_view: 'console',
  info_search_web: 'query',
  message_notify_user: 'text',
  message_ask_user: 'text',
};

export const TOOL_GROUP_LABEL: Record<string, string> = {
  shell: 'Terminal',
  file: 'File',
  browser: 'Browser',
  search: 'Search',
  info: 'Search',
  message: 'Message',
  mcp: 'MCP',
};

export const TOOL_GROUP_ICON: Record<string, LucideIcon> = {
  shell: TerminalIcon,
  file: FileTextIcon,
  browser: GlobeIcon,
  search: SearchIcon,
  info: SearchIcon,
  message: MessageSquareIcon,
  mcp: PuzzleIcon,
};

export interface ResolvedToolInfo {
  groupLabel: string;
  Icon: LucideIcon;
  functionLabel: string;
  functionArg: string;
  isMessageTool: boolean;
}

export function resolveToolInfo(name: string, fn: string, args: Record<string, unknown> | undefined | null): ResolvedToolInfo {
  const a = args ?? {};
  const isMcp = fn.startsWith('mcp_');
  const groupKey = isMcp ? 'mcp' : (name || '').toLowerCase();
  const Icon = TOOL_GROUP_ICON[groupKey] ?? WrenchIcon;
  const groupLabel = TOOL_GROUP_LABEL[groupKey] ?? (name || 'Tool');

  let functionLabel: string;
  let functionArg = '';

  if (isMcp) {
    functionLabel = fn.replace(/^mcp_/, '');
    const keys = Object.keys(a);
    if (keys.length > 0) {
      const v = a[keys[0]];
      if (typeof v === 'string' && v.length < 80) functionArg = v;
      else if (v !== undefined) functionArg = truncate(JSON.stringify(v), 60);
    }
  } else {
    functionLabel = TOOL_FUNCTION_LABEL[fn] ?? fn;
    const argKey = TOOL_FUNCTION_ARG_KEY[fn];
    if (argKey && a[argKey] !== undefined) {
      const v = a[argKey];
      functionArg = typeof v === 'string' ? v : truncate(JSON.stringify(v), 100);
    }
    // Strip the common /home/ubuntu prefix on file paths so they stay compact.
    if (argKey === 'file' || argKey === 'path') {
      functionArg = functionArg.replace(/^\/home\/ubuntu\//, '');
    }
  }

  return {
    groupLabel,
    Icon,
    functionLabel,
    functionArg,
    isMessageTool: groupKey === 'message',
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
