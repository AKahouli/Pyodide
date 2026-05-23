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
    const markerIndex = rawOutput.indexOf(PUBLIC_REASONING_MARKER);
    if (markerIndex === -1) {
      return {
        output: rawOutput,
        reasoningChain: [],
        markerFound: false,
      };
    }

    const visibleOutput = rawOutput.slice(0, markerIndex).trimEnd();
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

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonBlock);
    } catch {
      this.warn(context, 'invalid_json');
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

  private warn(context: { executionId: string; taskId: string }, reason: string): void {
    this.logger.warn(
      `Public reasoning parse warning for execution ${context.executionId} task ${context.taskId}: ${reason}`,
    );
  }
}
