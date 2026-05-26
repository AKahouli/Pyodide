import { Injectable, Logger } from '@nestjs/common';
import {
  ParsedPublicReasoning,
  PublicReasoningTraceItem,
} from '../../interfaces/playbook-flow-reasoning.interface';

const PUBLIC_REASONING_MARKER = '---PUBLIC_REASONING_TRACE_JSON---';
const MAX_PUBLIC_REASONING_BLOCK_BYTES = 64 * 1024;
const MAX_PUBLIC_REASONING_ITEMS = 50;
const MAX_PUBLIC_REASONING_LABEL_LENGTH = 200;
const MAX_PUBLIC_REASONING_DESCRIPTION_LENGTH = 2000;

@Injectable()
export class PlaybookFlowPublicReasoningParserService {
  private readonly logger = new Logger(PlaybookFlowPublicReasoningParserService.name);

  parse(
    rawOutput: string,
    context: { executionId: string; taskId: string },
  ): ParsedPublicReasoning {
    const markerIndex = this.findMarkerIndex(rawOutput, context);
    if (markerIndex === -1) {
      return {
        output: rawOutput,
        reasoningChain: [],
        markerFound: false,
      };
    }

    const echoedInstructionIndex = this.findEchoedInstructionIndex(rawOutput, markerIndex);
    const visibleOutput = this.resolveVisibleOutput(rawOutput, markerIndex, echoedInstructionIndex);
    if (echoedInstructionIndex !== -1) {
      this.warn(context, 'invalid_json');
      return {
        output: visibleOutput,
        reasoningChain: [],
        markerFound: true,
        parseError: 'invalid_json',
      };
    }
    const jsonBlock = rawOutput.slice(markerIndex + PUBLIC_REASONING_MARKER.length).trim();
    if (jsonBlock.length === 0) {
      this.warn(context, 'missing_json_block');
      return {
        output: visibleOutput,
        reasoningChain: [],
        markerFound: true,
        parseError: 'missing_json_block',
      };
    }

    if (Buffer.byteLength(jsonBlock, 'utf8') > MAX_PUBLIC_REASONING_BLOCK_BYTES) {
      this.warn(context, 'oversized_json_block');
      return {
        output: visibleOutput,
        reasoningChain: [],
        markerFound: true,
        parseError: 'oversized_json_block',
      };
    }

    const parsedJson = this.tryParseJson(jsonBlock, context);
    if (parsedJson === undefined) {
      return {
        output: visibleOutput,
        reasoningChain: [],
        markerFound: true,
        parseError: 'invalid_json',
      };
    }

    if (!Array.isArray(parsedJson)) {
      this.warn(context, 'json_root_not_array');
      return {
        output: visibleOutput,
        reasoningChain: [],
        markerFound: true,
        parseError: 'json_root_not_array',
      };
    }

    if (parsedJson.length > MAX_PUBLIC_REASONING_ITEMS) {
      this.warn(context, `truncating_items_to_${MAX_PUBLIC_REASONING_ITEMS}`);
    }

    const reasoningChain = parsedJson
      .slice(0, MAX_PUBLIC_REASONING_ITEMS)
      .flatMap((entry, index) => {
        const normalized = this.normalizeItem(entry);
        if (!normalized) {
          this.warn(context, `dropping_invalid_item_${index}`);
          return [];
        }
        return [normalized];
      });

    return {
      output: visibleOutput,
      reasoningChain,
      markerFound: true,
    };
  }

  private findMarkerIndex(rawOutput: string, context: { executionId: string; taskId: string }): number {
    const markerIndexes: number[] = [];
    let fromIndex = 0;
    while (fromIndex < rawOutput.length) {
      const nextIndex = rawOutput.indexOf(PUBLIC_REASONING_MARKER, fromIndex);
      if (nextIndex === -1) {
        break;
      }
      markerIndexes.push(nextIndex);
      fromIndex = nextIndex + PUBLIC_REASONING_MARKER.length;
    }

    for (let index = markerIndexes.length - 1; index >= 0; index -= 1) {
      const markerIndex = markerIndexes[index]!;
      const jsonBlock = rawOutput.slice(markerIndex + PUBLIC_REASONING_MARKER.length).trim();
      if (!jsonBlock) {
        continue;
      }
      const parsedJson = this.tryParseJson(jsonBlock, context, false);
      if (Array.isArray(parsedJson)) {
        return markerIndex;
      }
    }

    return markerIndexes[markerIndexes.length - 1] ?? -1;
  }

  normalizeReasoningTrace(rawItems: unknown[], context: { executionId: string; taskId: string }): PublicReasoningTraceItem[] {
    if (!Array.isArray(rawItems)) return [];
    return rawItems
      .slice(0, MAX_PUBLIC_REASONING_ITEMS)
      .flatMap((entry, index) => {
        const normalized = this.normalizeItem(entry);
        if (!normalized) {
          this.warn(context, `dropping_invalid_in_band_item_${index}`);
          return [];
        }
        return [normalized];
      });
  }

  private normalizeItem(entry: unknown): PublicReasoningTraceItem | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const item = entry as Record<string, unknown>;
    const id = this.readRequiredString(item.id);
    const type = this.readRequiredString(item.type);
    const label = this.readRequiredString(item.label, MAX_PUBLIC_REASONING_LABEL_LENGTH);
    const description = this.readRequiredString(item.description, MAX_PUBLIC_REASONING_DESCRIPTION_LENGTH);
    if (!id || !type || !label || !description) {
      return null;
    }

    const confidence = this.readConfidence(item.confidence);
    if (item.confidence !== undefined && confidence === undefined) {
      return null;
    }

    return {
      id,
      type,
      label,
      description,
      ...(confidence === null || confidence === undefined ? {} : { confidence }),
    };
  }

  private findEchoedInstructionIndex(rawOutput: string, markerIndex: number): number {
    const echoedInstructionIndex = rawOutput.lastIndexOf('Reasoning Trace:', markerIndex);
    if (echoedInstructionIndex >= 0) {
      const echoedBlock = rawOutput.slice(
        echoedInstructionIndex,
        markerIndex + PUBLIC_REASONING_MARKER.length,
      );
      const looksLikePromptEcho = echoedBlock.includes(PUBLIC_REASONING_MARKER)
        && (
          echoedBlock.includes('After your final answer')
          || echoedBlock.includes('MUST ALWAYS append')
          || echoedBlock.includes('Each item represents one step of your reasoning process')
        );
      if (looksLikePromptEcho) {
        return echoedInstructionIndex;
      }
    }

    return -1;
  }

  private resolveVisibleOutput(rawOutput: string, markerIndex: number, echoedInstructionIndex: number): string {
    if (echoedInstructionIndex !== -1) {
      return rawOutput.slice(0, echoedInstructionIndex).replace(/\s*"\s*$/, '').trimEnd();
    }

    return rawOutput.slice(0, markerIndex).trimEnd();
  }

  private readRequiredString(value: unknown, maxLength?: number): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return maxLength ? trimmed.slice(0, maxLength) : trimmed;
  }

  private readConfidence(value: unknown): number | null | undefined {
    if (value === null) {
      return null;
    }
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      return undefined;
    }
    return value;
  }

  private tryParseJson(
    jsonBlock: string,
    context: { executionId: string; taskId: string },
    warnOnFailure: boolean = true,
  ): unknown | undefined {
    try {
      return JSON.parse(jsonBlock);
    } catch {
      // LLMs commonly emit trailing ]] or leading prose before the JSON array.
      // Try stripping trailing ] noise first, then try extracting from the first [.
      let candidate = jsonBlock.trimEnd();
      while (candidate.length > 1) {
        const lastChar = candidate[candidate.length - 1];
        if (lastChar === ']') {
          candidate = candidate.slice(0, -1).trimEnd();
        } else {
          break;
        }
        try {
          return JSON.parse(candidate);
        } catch {
          // continue stripping
        }
      }

      // Leading prose: find the first [ and try to parse from there
      const arrayStart = jsonBlock.indexOf('[');
      const leadingProse = jsonBlock.slice(0, arrayStart).trim();
      if (
        arrayStart > 0
        && leadingProse.length > 0
        && leadingProse.length <= 80
        && !leadingProse.includes(':')
        && !leadingProse.includes(PUBLIC_REASONING_MARKER)
      ) {
        const fromArray = jsonBlock.slice(arrayStart);
        try {
          return JSON.parse(fromArray);
        } catch {
          // also try stripping trailing noise from the extracted array
          let trailing = fromArray.trimEnd();
          while (trailing.length > 1 && trailing[trailing.length - 1] === ']') {
            trailing = trailing.slice(0, -1).trimEnd();
            try {
              return JSON.parse(trailing);
            } catch {
              // continue
            }
          }
        }
      }

      if (warnOnFailure) {
        this.warn(context, 'invalid_json');
      }
      return undefined;
    }
  }

  private warn(context: { executionId: string; taskId: string }, reason: string): void {
    this.logger.warn(
      `Public reasoning parse warning for execution ${context.executionId} task ${context.taskId}: ${reason}`,
    );
  }
}
