export type PageItem = number | 'ellipsis';

/** Truncated page list: always first/last, current ±1, ellipsis for gaps. */
export function buildPageWindow(current: number, total: number): PageItem[] {
  const pages = new Set<number>([1, total]);
  for (let page = current - 1; page <= current + 1; page += 1) {
    if (page >= 1 && page <= total) pages.add(page);
  }
  const items: PageItem[] = [];
  let previous = 0;
  for (const page of [...pages].sort((a, b) => a - b)) {
    if (previous && page - previous > 1) items.push('ellipsis');
    items.push(page);
    previous = page;
  }
  return items;
}
