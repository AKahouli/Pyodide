import { Injectable } from '@nestjs/common';
import {
  FlowLlmPromptTraceItem,
  FlowToolTraceItem,
} from '../../interfaces/playbook-flow-observability.interface';

const REDACTED = '[REDACTED]';
const MAX_PROMPT_LENGTH = 8000;
const MAX_OUTPUT_SUMMARY_LENGTH = 2000;
const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|cookie|api[_-]?key/i;

@Injectable()
export class PlaybookFlowTraceRedactionService {
  redactToolTrace(items: FlowToolTraceItem[]): FlowToolTraceItem[] {
    return items.map((item) => ({
      ...item,
      args: this.redactRecord(item.args),
      outputSummary: this.truncateString(item.outputSummary, MAX_OUTPUT_SUMMARY_LENGTH),
      error: this.truncateString(item.error, MAX_OUTPUT_SUMMARY_LENGTH),
    }));
  }

  redactPromptTrace(items: FlowLlmPromptTraceItem[]): FlowLlmPromptTraceItem[] {
    return items.map((item) => ({
      ...item,
      prompt: this.truncateString(this.redactString(item.prompt), MAX_PROMPT_LENGTH) ?? '',
      generatedOutput: this.truncateString(this.redactString(item.generatedOutput ?? ''), MAX_PROMPT_LENGTH) || null,
    }));
  }

  redactRecord(value: Record<string, unknown>): Record<string, unknown> {
    return this.redactValue(value) as Record<string, unknown>;
  }

  private redactValue(value: unknown, key?: string): unknown {
    if (key && SENSITIVE_KEY_PATTERN.test(key)) {
      return REDACTED;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.redactValue(entry));
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [entryKey, entryValue]) => {
        acc[entryKey] = this.redactValue(entryValue, entryKey);
        return acc;
      }, {});
    }
    if (typeof value === 'string') {
      return this.redactString(value);
    }
    return value;
  }

  private redactString(value: string): string {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, `Bearer ${REDACTED}`)
      .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, `Basic ${REDACTED}`)
      .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;)\n]+/gi, (_match) => {
        const delim = _match.includes('=') ? '=' : ':';
        const keyPart = _match.split(/[=:]/)[0].trim();
        return `${keyPart}${delim} ${REDACTED}`;
      })
      .replace(/("(?:api[_-]?key|token|secret|password)"\s*:\s*")([^"]+)(")/gi, `$1${REDACTED}$3`);
  }

  private truncateString(value: string | null | undefined, maxLength: number): string | null | undefined {
    if (typeof value !== 'string') {
      return value;
    }
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}...`;
  }
}
