import { createElement, useContext, type ReactNode } from 'react';
import { Callout as OpenUICallout, ListBlock, ListItem as OpenUIListItem, StepsItem as OpenUIStepsItem, useTheme } from '@openuidev/react-ui';
import { chatLibrary } from '@openuidev/thesys';
import { cn } from '@/lib/utils';
import { CitationMarkdown, CitationText, CitedProse, hasMarker, OpenUiCitationContext } from './citations';

/**
 * Citation-aware versions of the text-bearing components of the thesys chat library. The stock ones
 * feed every string to a markdown block that has no hook for our chips, and the markup is not
 * exported, so each override mirrors the stock markup and class names (the thesys `c1-*` rules and
 * the OpenUI tokens apply unchanged) and is used only when one of its strings carries a
 * `[n]` marker: answers without citations keep the stock component.
 */
type Args = { props: Record<string, any>; renderNode: (node: unknown) => ReactNode; statementId?: string };
export type StockComponent = (args: Args) => ReactNode;

const str = (value: unknown) => (value == null ? '' : String(value));

/** The stock inline markdown block: markdown flattened to a span, `[n]` as a chip. Empty text renders nothing. */
function InlineCited({ text, className }: Readonly<{ text: string; className?: string }>) {
  const { mode } = useTheme();
  if (!text) return null;
  return (
    <span className={cn('c1-inline-markdown-renderer', className, { 'c1-inline-markdown-renderer--dark': mode === 'dark' })}>
      <CitationMarkdown inline textMarkdown={text} />
    </span>
  );
}

interface TextBlockProps { variant: string; primary: string; secondary?: string; type?: string; size?: string; secondaryTone?: 'positive' | 'negative' }

function CitedTextBlock({ variant, primary, secondary, type = 'text', size = 'sm', secondaryTone }: Readonly<TextBlockProps>) {
  const secondaryClass = cn('c1-text-block__secondary', secondaryTone && `c1-text-block__secondary--${secondaryTone}`);
  return (
    <div className={cn('c1-text-block', `c1-text-block--${variant}`, `c1-text-block--size-${size}`, 'c1-text-block--align-left', `c1-text-block--type-${type}`)}>
      <InlineCited text={primary} className='c1-text-block__primary' />
      {secondary && <InlineCited text={secondary} className={secondaryClass} />}
    </div>
  );
}

/** Only a `metric` subtext reads as a delta (green for a leading +, red for a leading -). */
function metricTone({ subtextVariant, subtext }: Record<string, any>): TextBlockProps['secondaryTone'] {
  if (subtextVariant !== 'metric' || !subtext) return undefined;
  if (subtext.startsWith('+')) return 'positive';
  return subtext.startsWith('-') ? 'negative' : undefined;
}

const CitedText: StockComponent = ({ props }) => (
  <CitedTextBlock variant={props.subtext ? 'text-subtext' : 'text'} primary={str(props.value)} secondary={props.subtext} type={props.variant} size={props.size} secondaryTone={metricTone(props)} />
);

const CitedBoldText: StockComponent = ({ props }) => {
  let variant = 'highlight-text';
  if (props.subtext) variant = 'highlight-text-number-subtext';
  else if (props.variant === 'number') variant = 'highlight-number';
  return <CitedTextBlock variant={variant} primary={str(props.value)} secondary={props.subtext} type={props.variant} size={props.size} secondaryTone={metricTone(props)} />;
};

/** The library's own `Icon` component, so the glyph set stays the stock one. */
function Glyph({ icon }: Readonly<{ icon: { props: Record<string, unknown> } | undefined }>) {
  if (!icon) return null;
  return createElement(chatLibrary.components.Icon.component as never, { props: icon.props, renderNode: () => null });
}

/** The stock badge maps its two extra variants to the neutral one. */
const badgeVariant = (variant: unknown) => (variant === 'filled' || variant === 'soft' || variant == null ? 'neutral' : String(variant));

const CitedIconText: StockComponent = ({ props }) => {
  const layout = props.layout ?? 'horizontal';
  return (
    <div className={cn('c1-icon-text', `c1-icon-text--${layout}`)}>
      <div className={cn('c1-icon-tag', 'c1-icon-tag--l', `c1-icon-tag--${badgeVariant(props.iconVariant)}`)}><Glyph icon={props.icon} /></div>
      <div className='c1-icon-text__content'>
        <CitedTextBlock variant={props.bold ? 'highlight-text-number-subtext' : 'text-subtext'} primary={str(props.title)} secondary={props.subtitle} size={layout === 'horizontal' ? 'xs' : 'sm'} />
      </div>
    </div>
  );
};

function InlineHeaderBlock({ heading, description }: Readonly<{ heading?: unknown; description?: unknown }>) {
  if (!heading && !description) return null;
  return (
    <div className='c1-inline-header'>
      {heading ? <div className='c1-inline-header-heading'><InlineCited text={str(heading)} /></div> : null}
      {description ? <div className='c1-inline-header-description'><InlineCited text={str(description)} /></div> : null}
    </div>
  );
}

const CitedInlineHeader: StockComponent = ({ props }) => <InlineHeaderBlock heading={props.heading} description={props.description} />;

const VARIANTS = ['neutral', 'info', 'warning', 'success', 'danger'] as const;

/** Same element as the stock CalloutV2 (variant defaults to neutral); only the title and description render chips. */
const CitedCallout: StockComponent = ({ props }) => (
  <OpenUICallout
    variant={VARIANTS.find((variant) => variant === props.variant) ?? 'neutral'}
    title={props.title ? <InlineCited text={str(props.title)} /> : undefined}
    description={props.description ? <InlineCited text={str(props.description)} /> : undefined}
  />
);

const CitedStepsItem: StockComponent = ({ props }) => (
  <OpenUIStepsItem
    title={<InlineCited text={str(props.title)} />}
    details={<CitedProse text={str(props.details)} />}
  />
);

/** Row-oriented `ListItem` of the stock List: icon glyph, or the image given by `src` (the stock one resolves it through a hook of its own). */
function CitedListItem({ item, variant }: Readonly<{ item: { props: Record<string, any> }; variant: 'icon' | 'image' | 'number' }>) {
  const { title, subtitle, icon, image } = item.props;
  return (
    <OpenUIListItem
      variant={variant}
      index={0}
      title={<InlineCited text={str(title)} />}
      subtitle={subtitle ? <InlineCited text={str(subtitle)} /> : undefined}
      icon={variant === 'icon' ? <Glyph icon={{ props: { name: icon?.props.name ?? 'circle-dot', category: icon?.props.category } }} /> : undefined}
      image={variant === 'image' && image?.props.src ? { src: image.props.src, alt: image.props.alt ?? str(title) } : undefined}
    />
  );
}

const CitedList: StockComponent = ({ props }) => {
  const variant = props.variant ?? 'number';
  return (
    <div className='c1-list c1-list--default' style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <InlineHeaderBlock heading={props.heading} description={props.description} />
      <ListBlock variant={variant}>
        <ListBlock variant={variant}>
          {((props.items ?? []) as { props: Record<string, any> }[]).map((item, index) => <CitedListItem key={index} item={item} variant={variant} />)}
        </ListBlock>
      </ListBlock>
    </div>
  );
};

const CitedEntityList: StockComponent = ({ props }) => {
  const size = props.size ?? 'default';
  const row = (entry: { left: string; right: string; rightVariant?: string }, kind: string, key: string) => (
    <div key={key} className={cn('c1-entity-list__row', `c1-entity-list__row--${kind}`)}>
      <span className={cn('c1-entity-list__cell-left', `c1-entity-list__cell-left--${kind}`)}><InlineCited text={str(entry.left)} /></span>
      <span className={cn('c1-entity-list__cell-right', `c1-entity-list__cell-right--${entry.rightVariant ?? 'text'}`, `c1-entity-list__cell-right--${kind}`)}><InlineCited text={str(entry.right)} /></span>
    </div>
  );
  return (
    <div className={cn('c1-entity-list', `c1-entity-list--${size}`)}>
      {size === 'default' && props.header && row(props.header, 'header', 'entity-list-header-row')}
      {(props.rows ?? []).map((entry: any, index: number) => row(entry, 'body', `entity-list-row-${index}`))}
      {size === 'default' && props.footer && row(props.footer, 'footer', 'entity-list-footer-row')}
    </div>
  );
};

/** True when any string anywhere in the value (props, nested items, rows) carries a marker (see hasMarker). */
function carriesMarker(value: unknown, byReference: ReadonlyMap<string, unknown>): boolean {
  if (typeof value === 'string') return hasMarker(value, byReference as never);
  if (Array.isArray(value)) return value.some((entry) => carriesMarker(entry, byReference));
  if (typeof value === 'object' && value !== null) return Object.values(value).some((entry) => carriesMarker(entry, byReference));
  return false;
}

/**
 * Renders the chip version only when the listed props carry a marker (deep scan, so item
 * arrays and rows count): everything else keeps the stock component.
 */
function whenCited(cited: StockComponent, fields: readonly string[]): (stock: StockComponent) => StockComponent {
  return (Stock) => function WhenCited(args) {
    const { byReference } = useContext(OpenUiCitationContext);
    const Cited = fields.some((field) => carriesMarker(args.props[field], byReference)) ? cited : Stock;
    return <Cited {...args} />;
  };
}

export const inlineTextOverrides: Record<string, (stock: StockComponent) => StockComponent> = {
  Text: whenCited(CitedText, ['value', 'subtext']),
  BoldText: whenCited(CitedBoldText, ['value', 'subtext']),
  IconText: whenCited(CitedIconText, ['title', 'subtitle']),
  InlineHeader: whenCited(CitedInlineHeader, ['heading', 'description']),
  CalloutV2: whenCited(CitedCallout, ['title', 'description']),
  StepsItem: whenCited(CitedStepsItem, ['title', 'details']),
  List: whenCited(CitedList, ['heading', 'description', 'items']),
  EntityList: whenCited(CitedEntityList, ['header', 'rows', 'footer']),
};

/** Header title and subtitle: the stock component takes nodes for both, so chips can be fed in directly. */
export function withCitedHeader(Stock: StockComponent): StockComponent {
  return function CitedHeader({ props, renderNode }) {
    const text = (value: unknown) => (typeof value === 'string' ? <CitationText text={value} /> : value);
    return <Stock props={{ ...props, title: text(props.title), subtitle: text(props.subtitle) }} renderNode={renderNode} />;
  };
}
