export interface MarkdownHeadingInfo {
  /** DOM element id of the rendered heading. */
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export const OUTLINE_HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

export type OutlineHeadingTag = (typeof OUTLINE_HEADING_TAGS)[number];

/**
 * Classes applied to headings when outline registration is active. h1–h3
 * mirror the shared markdown overrides; h4–h6 intentionally have no shared
 * override so non-outline consumers keep ReactMarkdown's native rendering.
 */
const OUTLINE_HEADING_CLASS: Record<OutlineHeadingTag, string> = {
  h1: 'text-xl font-bold mb-3 mt-6 first:mt-0',
  h2: 'text-lg font-bold mb-3 mt-5 first:mt-0',
  h3: 'text-base font-bold mb-2 mt-4 first:mt-0',
  h4: 'text-sm font-bold mb-2 mt-4 first:mt-0',
  h5: 'text-sm font-semibold mb-2 mt-3 first:mt-0',
  h6: 'text-xs font-semibold mb-2 mt-3 first:mt-0',
};

/** Extract the rendered text of a hast element (matches what the browser displays). */
export function extractHastText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const element = node as { type?: string; value?: string; children?: unknown[] };
  if (element.type === 'text') return element.value ?? '';
  return (element.children ?? []).map(extractHastText).join('');
}

type HeadingComponentProps = { node?: unknown; children?: React.ReactNode };

/**
 * Clone `components` with heading overrides that assign stable DOM anchor ids
 * (`outline-<outlineKey>-<tag>-<n>`, n unique per key) and collect heading
 * metadata during the render pass. Tags without a base override (h4–h6) are
 * rendered here with their classes — non-outline consumers never see them.
 */
export function applyOutlineHeadingOverrides(components: Record<string, unknown>, outlineKey: string, collected: MarkdownHeadingInfo[]): Record<string, unknown> {
  const withOutline = { ...components };
  let headingSeq = 0;
  for (const tag of OUTLINE_HEADING_TAGS) {
    const level = Number(tag[1]) as MarkdownHeadingInfo['level'];
    const baseRenderer = components[tag] as ((props: { children?: React.ReactNode; id?: string }) => React.ReactNode) | undefined;
    withOutline[tag] = (headingProps: HeadingComponentProps) => {
      const id = `outline-${outlineKey}-${tag}-${headingSeq++}`;
      collected.push({ id, level, text: extractHastText(headingProps.node).replace(/\s+/g, ' ').trim() });
      if (baseRenderer) return baseRenderer({ children: headingProps.children, id });
      const Tag = tag as keyof React.JSX.IntrinsicElements;
      return <Tag id={id} className={OUTLINE_HEADING_CLASS[tag]}>{headingProps.children}</Tag>;
    };
  }
  return withOutline;
}
