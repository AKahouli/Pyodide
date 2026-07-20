/**
 * TypeScript reference markdown renderer for the public embed widget SSE contract.
 * Mirror of `_ysMd` / `_ysInlineMd` in `widget-template.ts` (vanilla JS runtime).
 * Used only by `renderText` for `TextComponent.content` chunks.
 *
 * Supported syntax: headings (h1-h6), bold, italic, inline code, fenced code blocks,
 * markdown links `[label](url)`, unordered lists (`-` / `*`), GFM pipe tables,
 * paragraphs. Bare HTTP(S) URLs and email addresses are rendered as safe links.
 */

/** Converts assistant markdown to safe HTML for the embed widget text slot. */
export function widgetMarkdown(text: string): string {
  if (!text) return '';

  const lines = escapeHtml(text).split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let inList = false;

  const closeList = (): void => {
    if (inList) {
      result.push('</ul>');
      inList = false;
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        result.push('</code></pre>');
        inCodeBlock = false;
      } else {
        closeList();
        const lang = line.slice(3).trim();
        const langAttr = lang ? ` data-lang="${escapeAttr(lang)}"` : '';
        result.push(`<pre class="ys-md-codeblock"><code${langAttr}>`);
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      result.push(line || ' ');
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const table = parseTable(lines, lineIndex);
    if (table) {
      closeList();
      result.push(renderTable(table));
      lineIndex = table.endIndex;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      result.push(`<h${level} class="ys-md-h${level}">${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      if (!inList) {
        result.push('<ul class="ys-md-ul">');
        inList = true;
      }
      result.push(`<li>${inlineMarkdown(trimmed.replace(/^[-*]\s/, ''))}</li>`);
      continue;
    }

    closeList();
    result.push(`<p class="ys-md-p">${inlineMarkdown(trimmed)}</p>`);
  }

  if (inCodeBlock) result.push('</code></pre>');
  closeList();

  return result.join('\n');
}

function inlineMarkdown(text: string): string {
  const codeSegments: string[] = [];
  const linkSegments: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    const index = codeSegments.length;
    codeSegments.push(`<code class="ys-md-inline-code">${code}</code>`);
    return `\x00YS_CODE_${index}\x00`;
  });

  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) => storeLink(linkSegments, sanitizeLinkHref(href), label),
  );
  out = out.replace(
    /\[([^,\]\n]+),\s*(https?:\/\/[^\]\s]+)\]/gi,
    (_match, label: string, href: string) => storeLink(linkSegments, sanitizeHttpHref(href), label.trim()),
  );
  out = out.replace(/https?:\/\/[^\s<]+/gi, (url) => {
    const { href, trailing } = trimTrailingUrlPunctuation(url);
    return storeLink(linkSegments, sanitizeLinkHref(href), displayUrlLabel(href)) + trailing;
  });
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) =>
    storeLink(linkSegments, `mailto:${email}`, email),
  );
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');

  return out
    .replace(/\x00YS_LINK_(\d+)\x00/g, (_match, index: string) => linkSegments[Number(index)])
    .replace(/\x00YS_CODE_(\d+)\x00/g, (_match, index: string) => codeSegments[Number(index)]);
}

function storeLink(links: string[], href: string, label: string): string {
  const index = links.length;
  links.push(`<a href="${href}" target="_blank" rel="noopener noreferrer" class="ys-md-link">${label}</a>`);
  return `\x00YS_LINK_${index}\x00`;
}

function trimTrailingUrlPunctuation(url: string): { href: string; trailing: string } {
  const match = url.match(/^(.*?)([.,;:!?]+)?$/);
  return { href: match?.[1] || url, trailing: match?.[2] || '' };
}

function displayUrlLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

type MarkdownTable = {
  headers: string[];
  alignments: Array<'left' | 'center' | 'right'>;
  rows: string[][];
  endIndex: number;
};

function parseTable(lines: string[], startIndex: number): MarkdownTable | null {
  const headers = splitTableRow(lines[startIndex]);
  const delimiters = splitTableRow(lines[startIndex + 1] ?? '');
  if (!headers || !delimiters || headers.length < 2 || headers.length !== delimiters.length || !delimiters.every(isTableDelimiter)) {
    return null;
  }

  const rows: string[][] = [];
  let endIndex = startIndex + 1;
  for (let index = startIndex + 2; index < lines.length; index += 1) {
    const row = splitTableRow(lines[index]);
    if (!row || row.length !== headers.length) break;
    rows.push(row);
    endIndex = index;
  }

  return { headers, alignments: delimiters.map(tableAlignment), rows, endIndex };
}

function splitTableRow(line: string): string[] | null {
  if (!line.includes('|')) return null;

  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\' && line[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (char === '`') {
      inCode = !inCode;
      cell += char;
    } else if (char === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());

  if (line.trimStart().startsWith('|')) cells.shift();
  if (line.trimEnd().endsWith('|')) cells.pop();
  return cells;
}

function isTableDelimiter(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell);
}

function tableAlignment(cell: string): 'left' | 'center' | 'right' {
  const trimmed = cell.trim();
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
  if (trimmed.endsWith(':')) return 'right';
  return 'left';
}

function renderTable(table: MarkdownTable): string {
  const headers = table.headers.map((cell, index) => `<th class="ys-md-table-${table.alignments[index]}">${inlineMarkdown(cell)}</th>`).join('');
  const rows = table.rows
    .map((row) => `<tr>${row.map((cell, index) => `<td class="ys-md-table-${table.alignments[index]}">${inlineMarkdown(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="ys-md-table-wrap"><table class="ys-md-table"><thead><tr>${headers}</tr></thead>${rows ? `<tbody>${rows}</tbody>` : ''}</table></div>`;
}

function sanitizeLinkHref(href: string): string {
  return /^(https?:|mailto:)/i.test(href) ? href : '#';
}

function sanitizeHttpHref(href: string): string {
  return /^https?:\/\//i.test(href) ? href : '#';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
