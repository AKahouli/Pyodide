/**
 * Parses ADK chat_completion content into a single suggestion string.
 *
 * Supports various response formats and extracts the first meaningful suggestion.
 */

const MIN_PHRASE_LEN = 2;

/** Lines that are only placeholders, not real suggestions */
function isPlaceholderLine(line: string): boolean {
  return /^Suggestion\s*\d+\s*$/i.test(line) || /^[-*]\s*$/.test(line) || /^✅/.test(line) || /^✨/.test(line);
}

/**
 * Parses various response formats to extract a single suggestion.
 * Handles:
 * 1. Structured French layout with ✅ / ✨ sections (legacy)
 * 2. Plain text responses
 * 3. JSON { suggestions: string[] } (legacy)
 */
export function parseComposerSuggestionsContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // Try legacy JSON format first
  const jsonParsed = parseLegacyJsonSuggestions(trimmed);
  if (jsonParsed) return jsonParsed;

  // Try structured format (✅ Version corrigée / ✨ Suggestions)
  const structured = parseStructuredComposerResponse(trimmed);
  if (structured) return structured;

  // Fallback: return first meaningful line
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_PHRASE_LEN && !isPlaceholderLine(l));

  return lines[0] || trimmed;
}

function parseLegacyJsonSuggestions(content: string): string | null {
  let jsonText = content;
  const fenceMatch = content.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fenceMatch?.[1]) {
    jsonText = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('suggestions' in parsed) ||
    !Array.isArray((parsed as { suggestions: unknown }).suggestions)
  ) {
    return null;
  }

  const raw = (parsed as { suggestions: unknown[] }).suggestions;
  if (raw.length === 0) return null;

  const firstSuggestion = raw[0];
  if (typeof firstSuggestion === 'string') {
    return firstSuggestion.trim();
  }

  return null;
}

/**
 * Extracts the first meaningful suggestion from structured format.
 */
function parseStructuredComposerResponse(text: string): string | null {
  const similarSplit = text.split(/✨\s*Suggestions\s+similaires\s*:?\s*\n/i);
  if (similarSplit.length < 2) {
    // If no suggestions section, try to extract the corrected version
    const versionMatch =
      text.match(/✅\s*Version\s+corrigée\s*\n+([\s\S]*)/i) ||
      text.match(/Version\s+corrigée\s*\n+([\s\S]*)/i);
    if (versionMatch?.[1]) {
      const corrected = versionMatch[1].trim().replace(/\s*\n\s*/g, ' ').trim();
      if (corrected.length >= MIN_PHRASE_LEN) return corrected;
    }
    return null;
  }

  const afterSimilar = similarSplit[1].trim();
  const suggestionLines = afterSimilar
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_PHRASE_LEN && !isPlaceholderLine(l));

  return suggestionLines[0] || null;
}
