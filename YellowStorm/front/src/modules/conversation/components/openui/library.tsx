import './devtools-off';
import { useContext, useEffect, type ReactNode } from 'react';
import { createLibrary, useStateField, type DefinedComponent } from '@openuidev/react-lang';
import { Callout as OpenUICallout } from '@openuidev/react-ui';
import { openuiLibrary } from '@openuidev/react-ui/genui-lib';
import { CitationMarkdown, CitationText, hasKnownMarker, OpenUiCitationContext, OpenUiTextContent } from './citations';

/**
 * The stock OpenUI component library, with the text-bearing components rendered
 * through our citation chips so `[n]` markers work wherever the model writes
 * prose. Names, schemas and descriptions are untouched, so the prompt generated
 * from the stock library (scripts/generate-openui-prompt.mjs) stays valid.
 *
 * Stock components that render markdown through the shared block hard-wire it
 * (the library offers no hook), hence one override each:
 * - TextContent, MarkDownRenderer, Callout: reimplemented around CitationMarkdown;
 * - Steps, CardHeader, Table: the stock component is kept and fed chip elements
 *   (or a marked cell that `renderNode` resolves) in place of strings.
 */
type Args = { props: Record<string, any>; renderNode: (node: unknown) => ReactNode };
type StockComponent = (args: Args) => ReactNode;

const CITED = '__ysCitedText';
const cited = (text: string) => ({ [CITED]: text });
const isCited = (node: unknown): node is { [CITED]: string } => typeof node === 'object' && node !== null && CITED in node;

/** Resolves the marked strings of `withCitedStrings` to citation-aware markdown, everything else as usual. */
const resolveCited = (renderNode: Args['renderNode']): Args['renderNode'] => (node) => (isCited(node)
  ? <CitationMarkdown textMarkdown={node[CITED]} />
  : renderNode(node));

const MarkdownBlock: StockComponent = ({ props }) => (
  <CitationMarkdown textMarkdown={props.textMarkdown as string} variant={props.variant} />
);

/** Same behaviour as the stock Callout (variants, auto-dismiss through $visible); only the description renderer differs. */
const CalloutBlock: StockComponent = ({ props }) => {
  const field = useStateField('visible', props.visible);
  const hasVisibleBinding = field.isReactive;
  const isVisible = hasVisibleBinding ? field.value === true || (field.value as unknown) === 'true' : true;
  useEffect(() => {
    if (!hasVisibleBinding || !isVisible) return;
    const timer = setTimeout(() => field.setValue(false), 3000);
    return () => clearTimeout(timer);
  }, [hasVisibleBinding, isVisible, field]);
  if (!isVisible) return null;
  const variants: Record<string, 'neutral' | 'info' | 'warning' | 'success'> = { info: 'info', warning: 'warning', success: 'success', error: 'warning', neutral: 'neutral' };
  return (
    <OpenUICallout
      variant={variants[props.variant as string] || 'info'}
      title={<CitationText text={props.title as string} />}
      description={<CitationMarkdown textMarkdown={props.description as string} />}
      duration={hasVisibleBinding ? 3000 : undefined}
    />
  );
};

function withCitedSteps(Stock: StockComponent): StockComponent {
  return function CitedSteps({ props, renderNode }) {
    const items = (props.items ?? []).map((item: any) => (item?.props
      ? { ...item, props: { ...item.props,
        title: typeof item.props.title === 'string' ? <CitationText text={item.props.title} /> : item.props.title,
        details: typeof item.props.details === 'string' ? cited(item.props.details) : item.props.details } }
      : item));
    return <Stock props={{ ...props, items }} renderNode={resolveCited(renderNode)} />;
  };
}

function withCitedHeader(Stock: StockComponent): StockComponent {
  return function CitedHeader({ props, renderNode }) {
    const text = (value: unknown) => (typeof value === 'string' ? <CitationText text={value} /> : value);
    return <Stock props={{ ...props, title: text(props.title), subtitle: text(props.subtitle) }} renderNode={renderNode} />;
  };
}

function withCitedTable(Stock: StockComponent): StockComponent {
  return function CitedTable({ props, renderNode }) {
    const { byReference } = useContext(OpenUiCitationContext);
    const columns = (props.columns ?? []).map((column: any) => (Array.isArray(column?.props?.data)
      ? { ...column, props: { ...column.props, data: column.props.data.map((cell: unknown) => (hasKnownMarker(cell, byReference) ? cited(cell) : cell)) } }
      : column));
    return <Stock props={{ ...props, columns }} renderNode={resolveCited(renderNode)} />;
  };
}

const overrides: Record<string, (stock: StockComponent) => StockComponent> = {
  TextContent: () => OpenUiTextContent as StockComponent,
  MarkDownRenderer: () => MarkdownBlock,
  Callout: () => CalloutBlock,
  Steps: withCitedSteps,
  CardHeader: withCitedHeader,
  Table: withCitedTable,
};

export const openUiLibrary = createLibrary({
  id: openuiLibrary.id,
  root: openuiLibrary.root,
  componentGroups: openuiLibrary.componentGroups,
  components: Object.values(openuiLibrary.components).map((definition) => {
    const override = overrides[definition.name];
    return override ? ({ ...definition, component: override(definition.component as StockComponent) } as DefinedComponent) : definition;
  }),
});
