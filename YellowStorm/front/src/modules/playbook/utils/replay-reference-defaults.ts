type Translate = (key: string, values?: Record<string, string | number>) => string;

const MAX_JSON_DEPTH = 4;
const MAX_JSON_KEYS = 20;
const MAX_JSON_NODES = 100;
const MAX_KEY_LENGTH = 80;
const MAX_STRUCTURE_ITEMS = 24;
const MAX_HEADING_LENGTH = 120;
const MAX_GENERATED_GUIDE_LENGTH = 8000;

function limitText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function describeJsonShape(value: unknown, depth = 0, budget = { remaining: MAX_JSON_NODES }): unknown {
  if (depth >= MAX_JSON_DEPTH || budget.remaining <= 0) return '<value>';
  budget.remaining -= 1;
  if (Array.isArray(value)) {
    return value.length > 0 ? [describeJsonShape(value[0], depth + 1, budget)] : ['<item>'];
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_JSON_KEYS)
        .map(([key, child]) => [limitText(key, MAX_KEY_LENGTH), describeJsonShape(child, depth + 1, budget)]),
    );
  }
  if (value === null) return '<null>';
  return `<${typeof value}>`;
}

function countParagraphs(value: string): number {
  return value.split(/\n\s*\n/).filter((block) => block.trim().length > 0).length;
}

export function generateExpectedOutputFormat(referenceOutput: string | null | undefined, t: Translate): string | null {
  const source = referenceOutput?.trim();
  if (!source) return null;

  try {
    const parsed = JSON.parse(source) as unknown;
    const shape = JSON.stringify(describeJsonShape(parsed), null, 2);
    return limitText(t('nodeEditor.referenceFormatGeneratedJson', { shape }), MAX_GENERATED_GUIDE_LENGTH);
  } catch {
    // Non-JSON answers are summarized by their visible document structure.
  }

  const lines = source.split('\n');
  const headings = lines.flatMap((line) => {
    const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    return match ? [{ level: match[1].length, title: match[2] }] : [];
  });
  const tableCount = lines.filter((line) => /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line)).length;
  const unorderedListItems = lines.filter((line) => /^\s*[-*+]\s+\S/.test(line)).length;
  const orderedListItems = lines.filter((line) => /^\s*\d+[.)]\s+\S/.test(line)).length;
  const codeBlockCount = Math.floor(lines.filter((line) => /^\s*```/.test(line)).length / 2);
  const hasMarkdownStructure = headings.length > 0 || tableCount > 0 || unorderedListItems > 0 || orderedListItems > 0 || codeBlockCount > 0;

  if (hasMarkdownStructure) {
    const structure = [
      ...headings.map(({ level, title }) => t('nodeEditor.referenceFormatHeading', {
        level,
        title: limitText(title, MAX_HEADING_LENGTH),
      })),
      ...(tableCount > 0 ? [t('nodeEditor.referenceFormatTables', { count: tableCount })] : []),
      ...(unorderedListItems > 0 ? [t('nodeEditor.referenceFormatBullets', { count: unorderedListItems })] : []),
      ...(orderedListItems > 0 ? [t('nodeEditor.referenceFormatNumbered', { count: orderedListItems })] : []),
      ...(codeBlockCount > 0 ? [t('nodeEditor.referenceFormatCodeBlocks', { count: codeBlockCount })] : []),
    ].slice(0, MAX_STRUCTURE_ITEMS).map((item) => `- ${item}`).join('\n');

    return limitText(t('nodeEditor.referenceFormatGeneratedMarkdown', {
      structure,
      paragraphs: countParagraphs(source),
    }), MAX_GENERATED_GUIDE_LENGTH);
  }

  return limitText(t('nodeEditor.referenceFormatGeneratedPlain', {
    paragraphs: countParagraphs(source),
    lines: lines.filter((line) => line.trim().length > 0).length,
  }), MAX_GENERATED_GUIDE_LENGTH);
}
