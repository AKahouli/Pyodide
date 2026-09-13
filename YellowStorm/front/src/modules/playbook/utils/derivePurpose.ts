/**
 * Derives a one-line purpose (≤160 chars, never markdown) from a playbook
 * description. Descriptions range from a clean sentence to a 6,000-character
 * markdown construction prompt; both must land in the same one-line slot
 * without leaking markdown syntax (spec §6.1, defect B2).
 */

const MAX_LEN = 160;

const PROMPT_MARKERS = [
  'tu es un',
  'you are a',
  '## rôle',
  '## objectif',
  '## mission',
  'ta mission',
  'your task',
];

const OBJECTIVE_HEADING = /objectif|objective|but\b|goal|mission|purpose/i;

export interface Purpose {
  purpose: string;
  purposeIsDerived: boolean;
}

/** Strips everything that must never appear in the purpose line; keeps line structure. */
function normalize(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/<!--[\s\S]*?-->/g, ' ') // HTML comments
    .replace(/^---\n[\s\S]*?\n---/, ' ') // YAML front matter
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/(\*\*|__|\*|_|`|~~)/g, '') // emphasis / code / strike markers
    .split('\n')
    .map((line) => line.trim().replace(/^[-*+]\s+/, '')) // list markers
    .filter(Boolean)
    .join('\n');
}

function isPromptDump(normalized: string): boolean {
  if (normalized.length > 400) return true;
  const headings = normalized.match(/^#{1,6}\s/gm);
  if (headings && headings.length >= 2) return true;
  const lower = normalized.toLowerCase();
  return PROMPT_MARKERS.some((m) => lower.includes(m));
}

/** Body of the first section whose heading looks like an objective/mission. */
function extractFromObjectiveSection(normalized: string): string {
  const parts = normalized.split(/(?=#{1,6}\s)/);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    if (newline === -1) continue;
    const heading = part.slice(0, newline);
    if (!/^#{1,6}\s/.test(heading) || !OBJECTIVE_HEADING.test(heading)) continue;
    const body = part.slice(newline + 1).trim();
    if (body && !/^#{1,6}\s/.test(body)) return body;
  }
  return '';
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]*[.!?]/);
  return (match ? match[0] : text).trim();
}

function clamp(text: string, max = MAX_LEN): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trim();
}

/** Pure: no network, no locale-dependent formatting. */
export function derivePurpose(rawDescription: string | null | undefined): Purpose {
  if (!rawDescription || !rawDescription.trim()) return { purpose: '', purposeIsDerived: false };

  // A description made only of headings carries no purpose line at all.
  const hasContent = rawDescription
    .split('\n')
    .some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
  if (!hasContent) return { purpose: '', purposeIsDerived: false };

  const normalized = normalize(rawDescription);
  if (!normalized) return { purpose: '', purposeIsDerived: false };

  if (!isPromptDump(normalized)) {
    return { purpose: clamp(firstSentence(normalized.replace(/\n/g, ' '))), purposeIsDerived: false };
  }

  const extracted = extractFromObjectiveSection(normalized);
  // Never fall back to the first 160 chars of the prompt — that reproduces B2.
  if (!extracted) return { purpose: '', purposeIsDerived: false };
  return { purpose: clamp(firstSentence(extracted.replace(/\n/g, ' '))), purposeIsDerived: true };
}
