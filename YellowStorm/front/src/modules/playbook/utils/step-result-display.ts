type ResultLike = {
  output?: string | null;
  displayText?: string | null;
};

function safeParseJson(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function extractOutputText(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim() || null;
  if (!entry || typeof entry !== 'object') return null;

  const record = entry as Record<string, unknown>;
  const content = record.content;
  if (typeof content === 'string' && content.trim()) return content.trim();

  const value = record.value;
  if (typeof value === 'string' && value.trim()) return value.trim();

  return null;
}

function summarizeStructuredOutputs(payload: Record<string, unknown>): string | null {
  const collections = [payload.outputs, payload.ports];

  for (const collection of collections) {
    if (Array.isArray(collection)) {
      const lines = collection
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const record = entry as Record<string, unknown>;
          const text = extractOutputText(record);
          if (!text) return null;
          const label = record.label ?? record.output_port_id ?? record.outputPortId ?? record.port_id ?? record.portId ?? record.id;
          return typeof label === 'string' && label.trim() ? `${label}:\n${text}` : text;
        })
        .filter((value): value is string => Boolean(value));
      if (lines.length > 0) return lines.join('\n\n');
    }

    if (collection && typeof collection === 'object') {
      const lines = Object.entries(collection as Record<string, unknown>)
        .map(([key, value]) => {
          const text = extractOutputText(value);
          return text ? `${key}:\n${text}` : null;
        })
        .filter((value): value is string => Boolean(value));
      if (lines.length > 0) return lines.join('\n\n');
    }
  }

  return null;
}

export function getPreferredStepResultText(result: ResultLike | null | undefined): string | null {
  if (!result) return null;
  if (typeof result.displayText === 'string' && result.displayText.trim()) {
    return result.displayText.trim();
  }
  if (typeof result.output !== 'string' || !result.output.trim()) {
    return null;
  }

  const parsed = safeParseJson(result.output);
  if (!parsed) return result.output;

  const displayText = parsed.display_text ?? parsed.displayText;
  if (typeof displayText === 'string' && displayText.trim()) {
    return displayText.trim();
  }

  return summarizeStructuredOutputs(parsed) ?? result.output;
}
