/**
 * Client-side DOCX generation for answer / conversation exports. The `docx`
 * package is imported dynamically so it stays out of the main bundle.
 */

interface InlineRun {
  text: string;
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
}

export type DocxBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'bullet'; runs: InlineRun[] }
  | { kind: 'numbered'; runs: InlineRun[] }
  | { kind: 'quote'; runs: InlineRun[] }
  | { kind: 'code'; text: string };

/** Parse an inline markdown segment into styled runs (bold / italic / code). */
export function parseInlineMarkdown(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)([^*_]+?)\3|`([^`]+)`/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) runs.push({ text: text.slice(cursor, index) });
    if (match[2] !== undefined) runs.push({ text: match[2], bold: true });
    else if (match[4] !== undefined) runs.push({ text: match[4], italics: true });
    else if (match[5] !== undefined) runs.push({ text: match[5], code: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs.length ? runs : [{ text }];
}

/** Parse a markdown string into block specs consumable by the docx builder. */
export function parseMarkdownBlocks(markdown: string): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', runs: parseInlineMarkdown(text) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      flushParagraph();
      const codeLines: string[] = [];
      for (i += 1; i < lines.length && !/^```\s*$/.test(lines[i].trim()); i += 1) {
        codeLines.push(lines[i]);
      }
      if (codeLines.length) blocks.push({ kind: 'code', text: codeLines.join('\n') });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, runs: parseInlineMarkdown(heading[2]) });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      blocks.push({ kind: 'bullet', runs: parseInlineMarkdown(bullet[1]) });
      continue;
    }
    const numbered = /^\s*\d{1,9}[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      blocks.push({ kind: 'numbered', runs: parseInlineMarkdown(numbered[1]) });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: 'quote', runs: parseInlineMarkdown(quote[1]) });
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

/** Build the DOCX blob. Delay-loads `docx` to keep it out of the main chunk. */
export async function exportBlocksToDocx(blocks: Array<{ label: string; timestamp?: string; markdown: string }>, title: string): Promise<Blob> {
  const { Document, Packer, Paragraph, HeadingLevel, AlignmentType, TextRun } = await import('docx');

  const toRuns = (runs: InlineRun[], options: { bold?: boolean } = {}) =>
    runs.map((run) => new TextRun({
      text: run.text,
      bold: options.bold || run.bold,
      italics: run.italics,
      font: run.code ? 'Consolas' : undefined,
    }));

  const paragraphs: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] }),
  ];

  for (const block of blocks) {
    paragraphs.push(new Paragraph({
      spacing: { before: 240 },
      children: [new TextRun({ text: `${block.label}${block.timestamp ? ` · ${block.timestamp}` : ''}`, bold: true, color: '6B7280', size: 18 })],
    }));
    for (const parsed of parseMarkdownBlocks(block.markdown)) {
      switch (parsed.kind) {
        case 'heading':
          paragraphs.push(new Paragraph({
            heading: parsed.level === 1 ? HeadingLevel.HEADING_1 : parsed.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            children: toRuns(parsed.runs, { bold: true }),
          }));
          break;
        case 'bullet':
          paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: toRuns(parsed.runs) }));
          break;
        case 'numbered':
          paragraphs.push(new Paragraph({ numbering: { reference: 'export-numbered', level: 0 }, children: toRuns(parsed.runs) }));
          break;
        case 'quote':
          paragraphs.push(new Paragraph({ indent: { left: 480 }, children: toRuns(parsed.runs, { bold: false }).map((run) => run) }));
          break;
        case 'code':
          paragraphs.push(new Paragraph({ shading: { fill: 'F3F4F6' }, children: [new TextRun({ text: parsed.text, font: 'Consolas', size: 18 })] }));
          break;
        default:
          paragraphs.push(new Paragraph({ children: toRuns(parsed.runs) }));
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'export-numbered',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    sections: [{ children: paragraphs }],
  });
  return Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
