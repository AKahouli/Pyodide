/**
 * TypeScript reference markdown renderer for the public embed widget SSE contract.
 * Mirror of `_ysMd` / `_ysInlineMd` in `widget-template.ts` (vanilla JS runtime).
 * Used only by `renderText` for `TextComponent.content` chunks.
 *
 * Supported syntax: headings (h1–h3), bold, italic, inline code, fenced code blocks,
 * markdown links `[label](url)`, unordered lists (`-` / `*`), paragraphs.
 * Bare URLs are not auto-linked (sources use the `sources` component).
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

  for (const line of lines) {
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

    const heading = trimmed.match(/^(#{1,3})\s(.*)$/);
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
  let out = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    const index = codeSegments.length;
    codeSegments.push(`<code class="ys-md-inline-code">${code}</code>`);
    return `\x00YS_CODE_${index}\x00`;
  });

  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) =>
      `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" class="ys-md-link">${label}</a>`,
  );
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');

  return out.replace(/\x00YS_CODE_(\d+)\x00/g, (_match, index: string) => codeSegments[Number(index)]);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
