import './devtools-off';
import { useContext, type ReactNode } from 'react';
import { createLibrary, useIsStreaming, useFormName, useGetFieldValue, useSetDefaultValue, type DefinedComponent } from '@openuidev/react-lang';
import { Card as OpenUICard } from '@openuidev/react-ui';
import { chatLibrary } from '@openuidev/thesys';
import { cn } from '@/lib/utils';
import { CitationMarkdown, hasMarker, OpenUiCitationContext, OpenUiTextContent } from './citations';
import { inlineTextOverrides, withCitedHeader, type StockComponent } from './inline-text';
import { withDocumentImages } from './document-images';
import { OpenUiSubmissionContext } from './actions';
import { useModuleTranslation } from '@/modules/localization';
import { withDataTable } from './DataTable';
import { withChartExplorer } from './ChartExplorer';
import { miniAppComponents } from './MiniApp';
import { askAgentAction } from './mini-app-definitions';
import { miniAppFunctions } from './mini-app-functions';

/**
 * The thesys chat component library (root `Card`, SectionBlock, the card blocks, charts, FollowUpBlock),
 * with the text-bearing components rendered through our citation chips so `[n]` markers work wherever
 * the model writes prose. Names, schemas and descriptions are untouched, so the prompt generated from
 * the stock library (scripts/generate-openui-prompt.mjs) stays valid.
 *
 * The stock components render every string through a markdown block that has no hook, hence one
 * override each:
 * - TextContent, CalloutV2, StepsItem, Text, BoldText, IconText, InlineHeader, List, EntityList:
 *   reimplemented around our chips (inline-text.tsx), used only when a string carries a known marker;
 * - Header, Table: the stock component is kept and fed chip elements (or a marked cell that
 *   `renderNode` resolves) in place of strings;
 * - Card: the stock root opens its own source context and renders a Sources strip from its `sources`
 *   argument. Ours keeps the context of OpenUiRenderer (the answer's citations) and shows no strip,
 *   since the interface already lists the sources of an answer.
 *
 * Not covered, they take plain strings from the stock renderer: Tag, TagBlock, ImageText, ImageTextLarge,
 * MetricIndicator*, FollowUpBlock texts, Steps/Tabs/Accordion headings, SectionBlockItem and tab/accordion
 * triggers, chart labels, buttons.
 */
type Args = Parameters<StockComponent>[0];

const CITED = '__ysCitedText';
const cited = (text: string) => ({ [CITED]: text });
const isCited = (node: unknown): node is { [CITED]: string } => typeof node === 'object' && node !== null && CITED in node;

/** Resolves the marked strings of a table cell to citation-aware markdown, everything else as usual. */
const resolveCited = (renderNode: Args['renderNode']): Args['renderNode'] => (node) => (isCited(node)
  ? <CitationMarkdown inline textMarkdown={node[CITED]} />
  : renderNode(node));

/** Same table as the stock one; cells (rows are `cells[]` arrays) with a marker go through `renderNode` as chips. */
function withCitedTable(Stock: StockComponent): StockComponent {
  return function CitedTable(args) {
    const { props, renderNode } = args;
    const { byReference } = useContext(OpenUiCitationContext);
    const rows = (props.rows ?? []).map((row: unknown) => (Array.isArray(row)
      ? row.map((cell) => (hasMarker(cell, byReference) ? cited(cell) : cell))
      : row));
    return <Stock {...args} props={{ ...props, rows }} renderNode={resolveCited(renderNode)} />;
  };
}

/** Same layout as the stock chat `Card` (full width, card variant, streaming class), minus its own source context and strip. */
const CardBlock: StockComponent = function CardBlock({ props, renderNode }): ReactNode {
  const streaming = useIsStreaming();
  return (
    <OpenUICard width='full' variant='card' className={cn({ 'c1-card--streaming': streaming })}>
      {renderNode(props.children)}
    </OpenUICard>
  );
};

const overrides: Record<string, (stock: StockComponent) => StockComponent> = {
  ...inlineTextOverrides,
  Card: () => CardBlock,
  TextContent: () => OpenUiTextContent as StockComponent,
  Header: withCitedHeader,
  Table: (Stock) => withDataTable(withCitedTable(Stock)),
  BarChart: withChartExplorer,
  HorizontalBarChart: withChartExplorer,
  LineChart: withChartExplorer,
  Slider: (Stock) => function RegisteredSlider(args) {
    const formName = useFormName();
    const getFieldValue = useGetFieldValue();
    // The stock slider applies its fallback before checking whether state needs hydration.
    // Register the actual default so an untouched slider is included in submissions.
    useSetDefaultValue({ formName, componentType: 'Slider', name: args.props.name,
      existingValue: getFieldValue(formName, args.props.name), defaultValue: args.props.defaultValue });
    return <Stock {...args} />;
  },
  Form: (Stock) => function InteractiveForm(args) {
    const statuses = useContext(OpenUiSubmissionContext);
    const { t } = useModuleTranslation('conversation');
    const status = statuses[String(args.props.name ?? '')];
    return <fieldset disabled={status === 'submitting'} className='m-0 min-w-0 border-0 p-0' aria-busy={status === 'submitting'}>
      <Stock {...args} />
      {status && status !== 'error' && <p role='status' className='mt-2 text-sm text-muted-foreground'>
        {t(`openui.interaction.${status}`)}
      </p>}
    </fieldset>;
  },
};

const IMAGE_COMPONENTS = new Set(['Image', 'ImageBlock', 'ImageGallery', 'ImageText', 'ImageTextLarge', 'List', 'OptionCards',
  'ContextCardBlock', 'CompositeCardBlock', 'OverviewCardBlock', 'SnippetCardBlock', 'VisualCardBlock']);

export const openUiLibrary = createLibrary({
  root: chatLibrary.root,
  componentGroups: chatLibrary.componentGroups,
  components: [...Object.values(chatLibrary.components).map((definition) => {
    const override = overrides[definition.name];
    let component = override ? override(definition.component as StockComponent) : definition.component as StockComponent;
    if (IMAGE_COMPONENTS.has(definition.name)) component = withDocumentImages(component, definition.name);
    return { ...definition, component } as DefinedComponent;
  }), ...miniAppComponents],
  functions: miniAppFunctions,
  actions: [askAgentAction],
});
