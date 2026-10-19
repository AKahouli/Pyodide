// Adapted from Thesys open-intelligent-ui html-view.tsx (MIT); see MINI-APP-NOTICE.txt.
import { defineComponent, reactive } from '@openuidev/react-lang';
import { z } from 'zod/v4';

export const HtmlView = defineComponent({
  name: 'HtmlView',
  description: 'Rich isolated HTML/CSS/SVG artifact with controls. For autosave use inside MiniApp, with name and object $variable value. Strict mode removes generated scripts. Bind input/select/textarea data-state="key" (number/range keeps numbers, checkbox keeps boolean); data-text="key" safely displays a value; data-show="key" shows when true; data-filter="key" with data-filter-value="value" shows matching values or literal lowercase all; data-progress="key" sets a 0–100 percent width; SVG data-attr-width/height/x/y="key" binds numeric geometry. Keys must exist in the bound object. No URLs, files, document bodies, credentials or tools; keep document/task controls outside. Admin may enable inline JS: wait yellowmind.ready, read yellowmind.state, yellowmind.setState(patch), yellowmind.subscribe(render). Scripts run after completion. Exports need an open saved view; visuals are images beside editable text/tables.',
  props: z.object({ html: z.string().max(100_000), height: z.number().finite().min(80).max(2400).optional(), title: z.string().max(200).optional(),
    name: z.string().min(1).max(80).default('html'), value: reactive(z.record(z.string(), z.unknown())).optional() }),
  component: () => null,
});
