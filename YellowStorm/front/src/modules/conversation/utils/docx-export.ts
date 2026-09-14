/**
 * Client-side DOCX generation for answer / conversation exports. The `docx`
 * package is imported dynamically so it stays out of the main bundle.
 * Chart and HTML-preview components are rasterized offscreen (docx-capture)
 * so exports keep the visuals the chat UI shows.
 */

import type { MessageComponent } from '../types';
import { componentToMarkdown, getComponentType, isVisibleConversationComponent, normalizeChartComponentData } from '../utils';
import type { CapturedImage } from './docx-capture';

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
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: InlineRun[][]; rows: InlineRun[][][] };

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

const isTableRowLine = (line: string) => /^\s*\|.+\|\s*$/.test(line);
const isTableDelimiter = (line: string) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);
// Cells may contain escaped pipes (\|) — split on bare pipes only, then unescape.
const splitTableRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));

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
    if (isTableRowLine(line) && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRowLine(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'table', header: header.map(parseInlineMarkdown), rows: rows.map((row) => row.map(parseInlineMarkdown)) });
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

const MAX_IMAGE_WIDTH = 600;

const base64ToUint8 = (dataUrl: string) =>
  Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (char) => char.charCodeAt(0));

/** Build the DOCX blob. Delay-loads `docx` (and the capture module) to keep it out of the main chunk. */
export async function exportBlocksToDocx(
  blocks: Array<{ label: string; timestamp?: string; markdown?: string; components?: MessageComponent[] }>,
  title: string,
): Promise<Blob> {
  const { Document, Packer, Paragraph, HeadingLevel, AlignmentType, TextRun, Table, TableRow, TableCell, WidthType, ImageRun } = await import('docx');

  type DocxNode = InstanceType<typeof Paragraph> | InstanceType<typeof Table>;

  const toRuns = (runs: InlineRun[], options: { bold?: boolean } = {}) =>
    runs.map((run) => new TextRun({
      text: run.text,
      bold: options.bold || run.bold,
      italics: run.italics,
      font: run.code ? 'Consolas' : undefined,
    }));

  const children: DocxNode[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] }),
  ];

  const pushParsed = (parsed: DocxBlock) => {
    switch (parsed.kind) {
      case 'heading':
        children.push(new Paragraph({
          heading: parsed.level === 1 ? HeadingLevel.HEADING_1 : parsed.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          children: toRuns(parsed.runs, { bold: true }),
        }));
        break;
      case 'bullet':
        children.push(new Paragraph({ bullet: { level: 0 }, children: toRuns(parsed.runs) }));
        break;
      case 'numbered':
        children.push(new Paragraph({ numbering: { reference: 'export-numbered', level: 0 }, children: toRuns(parsed.runs) }));
        break;
      case 'quote':
        children.push(new Paragraph({ indent: { left: 480 }, children: toRuns(parsed.runs) }));
        break;
      case 'code':
        children.push(new Paragraph({ shading: { fill: 'F3F4F6' }, children: [new TextRun({ text: parsed.text, font: 'Consolas', size: 18 })] }));
        break;
      case 'table':
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ tableHeader: true, children: parsed.header.map((runs) => new TableCell({ children: [new Paragraph({ children: toRuns(runs, { bold: true }) })] })) }),
            ...parsed.rows.map((row) => new TableRow({ children: row.map((runs) => new TableCell({ children: [new Paragraph({ children: toRuns(runs) })] })) })),
          ],
        }));
        break;
      default:
        children.push(new Paragraph({ children: toRuns(parsed.runs) }));
    }
  };

  const pushImage = (image: CapturedImage, caption?: string) => {
    if (caption) {
      children.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: caption, bold: true, size: 20 })] }));
    }
    const width = Math.min(MAX_IMAGE_WIDTH, image.width);
    const height = Math.round(image.height * (width / image.width));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ type: 'png', data: base64ToUint8(image.dataUrl), transformation: { width, height } })],
    }));
  };

  const { captureChartPng, captureWebPreviewPng } = await import('./docx-capture');

  for (const block of blocks) {
    children.push(new Paragraph({
      spacing: { before: 240 },
      children: [new TextRun({ text: `${block.label}${block.timestamp ? ` · ${block.timestamp}` : ''}`, bold: true, color: '6B7280', size: 18 })],
    }));
    if (block.components?.length) {
      for (const component of block.components.filter(isVisibleConversationComponent)) {
        const type = getComponentType(component);
        if (type === 'chart') {
          const chart = normalizeChartComponentData(component.data);
          if (!chart) continue;
          const image = await captureChartPng(chart);
          if (image) pushImage(image, typeof chart.title === 'string' ? chart.title : undefined);
          continue;
        }
        if (type === 'webPreview') {
          const image = await captureWebPreviewPng(String(component.data?.content || ''));
          if (image) {
            pushImage(image);
          } else {
            // Capture failed (e.g. external resources tainting the canvas) — keep the HTML source.
            pushParsed({ kind: 'code', text: String(component.data?.content || '') });
          }
          continue;
        }
        const markdown = componentToMarkdown(component);
        if (markdown.trim()) parseMarkdownBlocks(markdown).forEach(pushParsed);
      }
    } else if (block.markdown) {
      parseMarkdownBlocks(block.markdown).forEach(pushParsed);
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'export-numbered',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    sections: [{ children }],
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
