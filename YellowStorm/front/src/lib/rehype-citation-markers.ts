// ============================================================================
// HAST node types (minimal, to avoid external dependency)
// ============================================================================

interface HastText {
  type: 'text';
  value: string;
}

interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

type HastNode = HastText | HastElement | { type: string; children?: HastNode[]; [k: string]: unknown };

/** Quick non-global test to check if a text node contains a citation marker. */
const HAS_CITATION = /\[\d+\]/;

/**
 * Rehype plugin that finds `[n]` citation markers in HAST text nodes
 * and replaces them with `<cite data-citation-ref="n">` elements.
 *
 * Runs as part of the ReactMarkdown pipeline — single DFS walk of the tree.
 * Naturally skips code blocks (they are already parsed into element nodes).
 */
export function rehypeCitationMarkers() {
  return (tree: HastNode) => {
    visitNode(tree);
  };
}

function visitNode(node: HastNode): void {
  if (!('children' in node) || !Array.isArray(node.children)) return;

  const newChildren: HastNode[] = [];
  let changed = false;

  for (const child of node.children) {
    if (child.type === 'text' && HAS_CITATION.test((child as HastText).value)) {
      const parts = splitTextNode((child as HastText).value);
      newChildren.push(...parts);
      changed = true;
    } else {
      visitNode(child);
      newChildren.push(child);
    }
  }

  if (changed) {
    node.children = newChildren;
  }
}

/**
 * Splits a text value containing `[n]` markers into an array of HAST text nodes
 * and `<cite>` element nodes. Uses matchAll for a single O(n) forward pass.
 */
function splitTextNode(value: string): HastNode[] {
  const result: HastNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(/\[(\d+)\]/g)) {
    // Text before this match
    if (match.index! > lastIndex) {
      result.push({ type: 'text', value: value.slice(lastIndex, match.index!) });
    }

    // <cite data-citation-ref="n">
    result.push({
      type: 'element',
      tagName: 'cite',
      properties: { 'data-citation-ref': match[1] },
      children: [],
    } as HastElement);

    lastIndex = match.index! + match[0].length;
  }

  // Remaining text after last match
  if (lastIndex < value.length) {
    result.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return result;
}
