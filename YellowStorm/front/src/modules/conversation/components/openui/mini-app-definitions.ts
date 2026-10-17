import { action, defineAction, defineComponent, reactive } from '@openuidev/react-lang';
import { z } from 'zod/v4';

// Shared by the prompt generator and mounted library; implementations are supplied by the host.
const name = z.string().min(1).max(80);
const label = z.string().min(1).max(200);
export const MiniApp = defineComponent({
  name: 'MiniApp', description: 'A reusable interactive panel inside Card. Fields are local; only an explicit AskAgent action runs inference. Give it a stable unique name.',
  props: z.object({ name, title: label, description: z.string().max(500), children: z.array(z.unknown()).max(20) }), component: () => null,
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
  props: z.object({ label, action: action(), validate: z.boolean().default(false) }), component: () => null,
});
export const MiniOutput = defineComponent({
  name: 'MiniOutput', description: 'Labelled reactive text, number, boolean, object or array result. Pass expressions or registered function results. Null displays a clear invalid/empty-result message. No HTML execution.',
  props: z.object({ label, value: z.unknown() }), component: () => null,
});
export const MiniList = defineComponent({
  name: 'MiniList', description: 'Reactive list of at most 200 strings, e.g. @FilterText(items, $query), with an explicit empty message.',
  props: z.object({ items: z.array(z.string().max(5000)).max(200), emptyText: label }), component: () => null,
});
export const miniAppDefinitions = [MiniApp, MiniInput, MiniSelect, MiniToggle, MiniButton, MiniOutput, MiniList];
export const askAgentAction = defineAction({
  name: 'AskAgent', description: 'Explicitly ask the existing conversation agent to perform the instruction using typed inputs and the current authorized conversation documents. Not a local function. Results arrive as a new answer. Never invent a result or silently call tools.',
  params: z.object({ instruction: z.string().min(1).max(2000), inputs: z.record(z.string(), z.unknown()) }),
});
