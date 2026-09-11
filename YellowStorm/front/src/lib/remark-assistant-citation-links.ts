interface MdastText {
  type: 'text';
  value: string;
}

interface MdastLink {
  type: 'link';
  url: string;
  children: MdastNode[];
}

interface MdastHtml {
  type: 'html';
  value: string;
}

interface MdastParent {
  type: string;
  children?: MdastNode[];
}

type MdastNode = MdastText | MdastLink | MdastHtml | MdastParent;

const ASSISTANT_CITATION = /\[([^,\]\n]+),\s*(https?:\/\/[^\]\s]+)\]/gi;

/** Converts the assistant's `[Title, https://url]` shorthand into an ordinary Markdown link. */
export function remarkAssistantCitationLinks() {
  return (tree: MdastNode) => visitNode(tree);
}

function visitNode(node: MdastNode): void {
  if (!hasChildren(node)) return;

  const children = node.children;
  const nextChildren: MdastNode[] = [];
  let changed = false;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const next = children[index + 1];
    const afterNext = children[index + 2];

    const htmlLink = parseHtmlLink(children, index);
    if (htmlLink) {
      nextChildren.push(htmlLink.link);
      index = htmlLink.endIndex;
      changed = true;
      continue;
    }

    // remark-gfm parses the URL in the shorthand as a standalone link node.
    const splitCitation = parseSplitCitation(child, next, afterNext);
    if (splitCitation) {
      nextChildren.push(...splitCitation.nodes);
      // Revisit the remainder: it may open another GFM-split citation.
      // parseSplitCitation guarantees afterNext is MdastText (isText check inside).
      (afterNext as MdastText).value = splitCitation.remainder;
      index += 1;
      changed = true;
      continue;
    }

    if (isText(child)) {
      const nodes = splitTextCitation(child.value);
      if (nodes.length !== 1 || !isText(nodes[0]) || nodes[0].value !== child.value) {
        nextChildren.push(...nodes);
        changed = true;
        continue;
      }
    }

    // Existing Markdown links must remain unchanged and never contain nested links.
    if (!isLink(child)) visitNode(child);
    nextChildren.push(child);
  }

  if (changed) node.children = nextChildren;
}

function parseHtmlLink(children: MdastNode[], startIndex: number): { link: MdastLink; endIndex: number } | null {
  const opening = children[startIndex];
  if (!isHtml(opening)) return null;

  const href = opening.value.match(/^\s*<a\b[^>]*\s+href\s*=\s*(["'])(.*?)\1[^>]*>\s*$/i)?.[2];
  if (!href || !isHttpUrl(href)) return null;

  for (let index = startIndex + 1; index < children.length; index += 1) {
    const node = children[index];
    if (isHtml(node) && /^\s*<\/a\s*>\s*$/i.test(node.value)) {
      const linkChildren = children.slice(startIndex + 1, index);
      if (!linkChildren.length || linkChildren.some((child) => isHtml(child) || isLink(child))) return null;
      return { link: { type: 'link', url: href, children: linkChildren }, endIndex: index };
    }
  }

  return null;
}

function parseSplitCitation(first: MdastNode, link: MdastNode | undefined, last: MdastNode | undefined): { nodes: MdastNode[]; remainder: string } | null {
  if (!isText(first) || !isLink(link) || !isText(last) || !isHttpUrl(link.url) || !last.value.startsWith(']')) return null;

  const match = first.value.match(/^(.*)\[([^,\]\n]+),\s*$/s);
  const title = match?.[2]?.trim();
  if (!match || !title) return null;

  const nodes: MdastNode[] = [];
  if (match[1]) nodes.push({ type: 'text', value: match[1] });
  nodes.push(createLink(title, link.url));
  return { nodes, remainder: last.value.slice(1) };
}

function splitTextCitation(value: string): MdastNode[] {
  const nodes: MdastNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(ASSISTANT_CITATION)) {
    const title = match[1].trim();
    const url = match[2];
    if (!title || !isHttpUrl(url)) continue;
    if (match.index! > lastIndex) nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    nodes.push(createLink(title, url));
    lastIndex = match.index! + match[0].length;
  }

  if (!nodes.length) return [{ type: 'text', value }];
  if (lastIndex < value.length) nodes.push({ type: 'text', value: value.slice(lastIndex) });
  return nodes;
}

function createLink(title: string, url: string): MdastLink {
  return { type: 'link', url, children: [{ type: 'text', value: title }] };
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function hasChildren(node: MdastNode): node is MdastParent & { children: MdastNode[] } {
  return 'children' in node && Array.isArray(node.children);
}

function isText(node: MdastNode | undefined): node is MdastText {
  return node?.type === 'text' && 'value' in node;
}

function isHtml(node: MdastNode | undefined): node is MdastHtml {
  return node?.type === 'html' && 'value' in node;
}

function isLink(node: MdastNode | undefined): node is MdastLink {
  return node?.type === 'link' && 'url' in node;
}
