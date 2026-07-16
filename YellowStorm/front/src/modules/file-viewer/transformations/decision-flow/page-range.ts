export type PageRangeErrorCode = 'required' | 'invalid' | 'descending' | 'outOfBounds' | 'tooMany';

export class PageRangeError extends Error {
  constructor(readonly code: PageRangeErrorCode) {
    super(code);
  }
}

export function parsePageRange(input: string, pageCount: number): number[] {
  if (!input.trim()) throw new PageRangeError('required');
  const pages = new Set<number>();
  for (const rawPart of input.split(',')) {
    const part = rawPart.trim();
    if (!part) throw new PageRangeError('invalid');
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new PageRangeError('invalid');
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) throw new PageRangeError('outOfBounds');
    if (end < start) throw new PageRangeError('descending');
    for (let page = start; page <= end; page += 1) {
      pages.add(page);
      if (pages.size > 500) throw new PageRangeError('tooMany');
    }
  }
  return [...pages].sort((a, b) => a - b);
}
