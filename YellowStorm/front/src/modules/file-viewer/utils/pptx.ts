const PPTX_HIGHLIGHT_ATTR = 'data-pptx-highlight';
const HIGHLIGHT_CLASS = 'rounded-sm bg-amber-300/60 px-0.5 text-foreground dark:bg-amber-500/30';

export function waitForPptxSlides(container: HTMLElement, timeout = 30000): Promise<HTMLElement[]> {
  const existing = container.querySelectorAll<HTMLElement>('.slide');
  if (existing.length > 0) {
    return Promise.resolve(Array.from(existing));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out while rendering slides.'));
    }, timeout);

    const observer = new MutationObserver(() => {
      const slides = container.querySelectorAll<HTMLElement>('.slide');
      if (slides.length > 0) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(Array.from(slides));
      }
    });

    observer.observe(container, { childList: true, subtree: true });
  });
}

export function clearPptxHighlights(root: HTMLElement | null) {
  if (!root) return;
  const highlights = root.querySelectorAll<HTMLElement>(`mark[${PPTX_HIGHLIGHT_ATTR}]`);
  highlights.forEach((mark) => {
    const text = document.createTextNode(mark.textContent ?? '');
    mark.replaceWith(text);
    mark.parentElement?.normalize();
  });
}

export function highlightPptxMatches(root: HTMLElement, query: string): HTMLElement[] {
  const matches: HTMLElement[] = [];
  const normalized = normalizeSearchString(query);
  if (!normalized) {
    return matches;
  }

  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let totalLength = 0;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const value = textNode.nodeValue ?? '';
    if (!value) continue;
    const start = totalLength;
    const sanitized = normalizeTextValue(value);
    totalLength += sanitized.length;
    nodes.push({ node: textNode, start, end: totalLength });
  }

  if (!nodes.length) {
    return matches;
  }

  const fullText = nodes.map((entry) => normalizeTextValue(entry.node.nodeValue ?? '')).join('');
  const lowerText = fullText.toLowerCase();
  const needle = normalized.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  let searchIndex = lowerText.indexOf(needle);

  while (searchIndex !== -1) {
    ranges.push({ start: searchIndex, end: searchIndex + needle.length });
    searchIndex = lowerText.indexOf(needle, searchIndex + needle.length);
  }

  if (!ranges.length) {
    return matches;
  }

  let groupCounter = 0;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const info = ranges[i];
    const groupId = `pptx-match-${groupCounter++}`;
    const fragments = wrapMatchFragments(nodes, info.start, info.end, groupId);
    if (fragments.length) {
      matches.push(fragments[0]);
    }
  }

  return matches.reverse();
}

function wrapMatchFragments(nodes: Array<{ node: Text; start: number; end: number }>, start: number, end: number, groupId: string): HTMLElement[] {
  const fragments: HTMLElement[] = [];

  for (const entry of nodes) {
    if (entry.end <= start) {
      continue;
    }
    if (entry.start >= end) {
      break;
    }

    const nodeValue = entry.node.nodeValue ?? '';
    if (!nodeValue) {
      continue;
    }
    if (entry.node.parentElement?.closest(`mark[${PPTX_HIGHLIGHT_ATTR}]`)) {
      continue;
    }

    const overlapStart = Math.max(start, entry.start);
    const overlapEnd = Math.min(end, entry.end);
    if (overlapEnd <= overlapStart) {
      continue;
    }

    const localStart = overlapStart - entry.start;
    const localEnd = overlapEnd - entry.start;
    const fragment = wrapTextFragment(entry.node, localStart, localEnd, groupId);
    if (fragment) {
      fragments.push(fragment);
    }
  }

  return fragments;
}

function wrapTextFragment(node: Text, startOffset: number, endOffset: number, groupId: string): HTMLElement | null {
  if (startOffset === endOffset) {
    return null;
  }
  const parent = node.parentNode;
  if (!parent) {
    return null;
  }

  const fragmentNode = node.splitText(startOffset);
  const remainder = fragmentNode.splitText(endOffset - startOffset);
  const highlight = document.createElement('mark');
  highlight.dataset.pptxHighlight = 'true';
  highlight.dataset.pptxHighlightGroup = groupId;
  highlight.className = HIGHLIGHT_CLASS;
  remainder.before(highlight);
  highlight.appendChild(fragmentNode);
  return highlight;
}

function normalizeTextValue(value: string): string {
  return value.replaceAll(/\s/g, ' ');
}

function normalizeSearchString(value: string): string {
  return normalizeTextValue(value).trim();
}

export function downloadPptxFile(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export { PPTX_HIGHLIGHT_ATTR };
