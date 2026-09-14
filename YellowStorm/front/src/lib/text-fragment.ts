export interface TextFragmentSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

const MAX_EXACT_SELECTOR_LENGTH = 50;

export function buildTextFragmentUrl(url: string, selector: TextFragmentSelector): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('Web citations require an HTTP(S) URL');
  if (!selector.exact.trim()) return parsed.toString();

  const normalizedExact = selector.exact.trim().replace(/\s+/g, ' ');
  const boundary = normalizedExact.lastIndexOf(' ', MAX_EXACT_SELECTOR_LENGTH);
  const exact = normalizedExact.length <= MAX_EXACT_SELECTOR_LENGTH
    ? normalizedExact
    : normalizedExact.slice(0, boundary > 0 ? boundary : MAX_EXACT_SELECTOR_LENGTH);
  const anchor = parsed.hash.slice(1).split(':~:')[0];
  const prefix = selector.prefix?.trim() ? `${encodeURIComponent(selector.prefix.trim())}-,` : '';
  const suffix = exact === normalizedExact && selector.suffix?.trim()
    ? `,-${encodeURIComponent(selector.suffix.trim())}`
    : '';
  parsed.hash = `${anchor}:~:text=${prefix}${encodeURIComponent(exact)}${suffix}`;
  return parsed.toString();
}
