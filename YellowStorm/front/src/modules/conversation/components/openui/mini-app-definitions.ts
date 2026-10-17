import { action, defineAction, defineComponent, reactive } from '@openuidev/react-lang';
import { z } from 'zod/v4';

// Shared by the prompt generator and mounted library; implementations are supplied by the host.
const name = z.string().min(1).max(80);
const label = z.string().min(1).max(200);
const children = z.array(z.unknown()).max(40);
const gap = z.number().int().min(0).max(12).default(3);
const align = z.enum(['start', 'center', 'end', 'stretch']).default('stretch');
const textAlign = z.enum(['start', 'center', 'end']).default('start');
const width = z.enum(['compact', 'medium', 'full']).default('full');
export const MiniRow = defineComponent({
  name: 'MiniRow', description: 'Horizontal group; gap uses 4px steps.',
  props: z.object({ children, gap, align: align.default('center'), justify: z.enum(['start', 'center', 'end', 'between']).default('start'), wrap: z.boolean().default(true) }), component: () => null,
});
export const MiniColumn = defineComponent({
  name: 'MiniColumn', description: 'Vertical group; preserves app scope.',
  props: z.object({ children, gap, align }), component: () => null,
});
export const MiniGrid = defineComponent({
  name: 'MiniGrid', description: 'Equal-width columns. Set minChildWidth for responsive cards; omit it for a fixed keypad.',
  props: z.object({ children, columns: z.number().int().min(1).max(6).default(2), minChildWidth: z.number().int().min(80).max(640).optional(), gap }), component: () => null,
});
export const MiniPanel = defineComponent({
  name: 'MiniPanel', description: 'Grouped surface; padding/gap use 4px steps.',
  props: z.object({ children, surface: z.enum(['plain', 'soft', 'outline']).default('soft'), padding: z.number().int().min(0).max(12).default(5), gap, width, radius: z.enum(['md', 'lg', 'xl']).default('xl') }), component: () => null,
});
export const MiniText = defineComponent({
  name: 'MiniText', description: 'Reactive text with heading, body, caption or prominent display hierarchy. Semantic tone only.',
  props: z.object({ text: z.string().max(20_000), kind: z.enum(['heading', 'body', 'caption', 'display']).default('body'), align: textAlign, tone: z.enum(['default', 'muted', 'success', 'danger']).default('default') }), component: () => null,
});
export const MiniApp = defineComponent({
  name: 'MiniApp', description: 'A reusable interactive panel inside Card. Fields are local; only an explicit AskAgent action runs inference. Give it a stable unique name.',
  props: z.object({ name, title: label, description: z.string().max(500), children: z.array(z.unknown()).max(20), width }), component: () => null,
});
export const MiniInput = defineComponent({
  name: 'MiniInput', description: 'Labelled two-way $variable input. Use text, number or textarea; numeric blank is null, not zero. Text maximum 5000 characters. Use required/min/max and validate the Run button.',
  props: z.object({ name, label, value: reactive(z.union([z.string().max(5000), z.number().finite(), z.null()])),
    kind: z.enum(['text', 'number', 'textarea']).default('text'), required: z.boolean().default(false),
    min: z.number().finite().optional(), max: z.number().finite().optional() }), component: () => null,
});
export const MiniSelect = defineComponent({
  name: 'MiniSelect', description: 'Labelled selection bound to a string $variable. Options have value and label; at most 50 options.',
  props: z.object({ name, label, value: reactive(z.string().max(200)), options: z.array(z.object({ value: z.string().max(200), label })).min(1).max(50) }), component: () => null,
});
export const MiniToggle = defineComponent({
  name: 'MiniToggle', description: 'Labelled checkbox bound to a boolean $variable.',
  props: z.object({ name, label, value: reactive(z.boolean()) }), component: () => null,
});
export const MiniButton = defineComponent({
  name: 'MiniButton', description: 'Explicit local Action(@Set/@Reset) or agent Action(@AskAgent). Set validate=true for AskAgent so the panel validates required fields and ranges before sending. Local reset uses validate=false.',
  props: z.object({ label, action: action(), validate: z.boolean().default(false), variant: z.enum(['solid', 'outline', 'soft', 'ghost']).default('solid'), size: z.enum(['sm', 'md', 'lg']).default('md'), icon: z.enum(['plus', 'minus', 'check', 'refresh', 'arrow-right', 'download', 'copy', 'x']).optional(), disabled: z.boolean().default(false), block: z.boolean().default(false), radius: z.enum(['md', 'lg', 'full']).default('md') }), component: () => null,
});
export const MiniOutput = defineComponent({
  name: 'MiniOutput', description: 'Labelled reactive text, number, boolean, object or array result. Pass expressions or registered function results. Null displays a clear invalid/empty-result message. No HTML execution.',
  props: z.object({ label, value: z.unknown(), size: z.enum(['body', 'display', 'compact']).default('body'), align: textAlign }), component: () => null,
});
export const MiniList = defineComponent({
  name: 'MiniList', description: 'Reactive list of at most 200 strings, e.g. @FilterText(items, $query), with an explicit empty message.',
  props: z.object({ items: z.array(z.string().max(5000)).max(200), emptyText: label }), component: () => null,
});
export const MiniDocument = defineComponent({
  name: 'MiniDocument', description: 'Host-controlled selector of completed files uploaded to this conversation. Bind a string document ID, initially empty. Upload through the composer first. Never invent IDs or URLs.',
  props: z.object({ name, label, value: reactive(z.string().max(24)), required: z.boolean().default(true) }), component: () => null,
});
export const MiniTaskResult = defineComponent({
  name: 'MiniTaskResult', description: 'Host-owned status and saved agent result for the enclosing MiniApp. Shows loading, cancellation, errors and stale inputs; restores the actual answer after reload without running inference. Place after its AskAgent button.',
  props: z.object({ label, inputs: z.record(z.string(), z.unknown()) }), component: () => null,
});
export const miniAppDefinitions = [MiniApp, MiniInput, MiniSelect, MiniToggle, MiniButton, MiniOutput, MiniList, MiniDocument, MiniTaskResult, MiniRow, MiniColumn, MiniGrid, MiniPanel, MiniText];
export const askAgentAction = defineAction({
  name: 'AskAgent', description: 'Explicitly ask the existing conversation agent to perform the instruction using typed inputs and the current authorized conversation documents. Not a local function. Results arrive as a new answer. Never invent a result or silently call tools.',
  params: z.object({ instruction: z.string().min(1).max(2000), inputs: z.record(z.string(), z.unknown()), documentIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(5).optional() }),
});
