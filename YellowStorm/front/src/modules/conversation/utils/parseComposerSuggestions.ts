/**
 * Parses ADK chat_completion content into four chip strings:
 * [version corrigée, suggestion1, suggestion2, suggestion3].
 *
 * Supports (1) structured French layout with ✅ / ✨ sections, (2) legacy JSON { suggestions: string[4] }.
 */

const MIN_PHRASE_LEN = 2;

function parseLegacyJsonSuggestions(content: string): string[] | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  let jsonText = trimmed;
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
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
  if (raw.length !== 4) return null;

  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    const s = item.trim();
    if (!s) return null;
    out.push(s);
  }

  return out;
}

/** Lines that are only placeholders, not real suggestions */
function isPlaceholderLine(line: string): boolean {
  return /^Suggestion\s*\d+\s*$/i.test(line) || /^[-*]\s*$/.test(line);
}

/**
 * ✅ Version corrigée ... ✨ Suggestions similaires : ... 3 lines
 */
function parseStructuredComposerResponse(text: string): string[] | null {
  const t = text.trim();
  if (!t) return null;

  const similarSplit = t.split(/✨\s*Suggestions\s+similaires\s*:?\s*\n/i);
  if (similarSplit.length < 2) return null;

  const beforeSimilar = similarSplit[0].trim();
  const afterSimilar = similarSplit[1].trim();

  let corrected = '';
  const versionMatch =
    beforeSimilar.match(/✅\s*Version\s+corrigée\s*\n+([\s\S]*)/i) ||
    beforeSimilar.match(/Version\s+corrigée\s*\n+([\s\S]*)/i);
  if (versionMatch?.[1]) {
    corrected = versionMatch[1].trim().replace(/\s*\n\s*/g, ' ').trim();
  }

  const suggestionLines = afterSimilar
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_PHRASE_LEN && !isPlaceholderLine(l));

  if (corrected.length >= MIN_PHRASE_LEN && suggestionLines.length >= 3) {
    return [corrected, ...suggestionLines.slice(0, 3)];
  }

  return null;
}

export function parseComposerSuggestionsContent(content: string): string[] | null {
  const structured = parseStructuredComposerResponse(content);
  if (structured && structured.length === 4) return structured;

  const legacy = parseLegacyJsonSuggestions(content);
  if (legacy) return legacy;

  return null;
}
