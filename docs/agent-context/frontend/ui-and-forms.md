# UI, forms and internationalisation

Read only the sections relevant to the task. Paths such as `src/` are relative to `YellowStorm/front/`; verify descriptive module examples and recorded debt against current source. Essential edit rules are in [frontend AGENTS.md](../../../YellowStorm/front/AGENTS.md).

## Forms

`react-hook-form` + `zod` + shadcn `<Form>` primitives. Zod schema first, type with `z.infer`. Use `<FormField>` / `<FormMessage>` — don't render errors manually. Use `scrollToFirstError` from `@/lib/form-utils` for long forms on submit failure. Validation messages map to translation keys where user-facing.

**Autosaved editors:** keep editable form data in a single draft object (or a form library state object), not scattered independent `useState` fields. Autosave effects should depend on that single draft object so adding a field cannot be missed in a dependency list. Standalone state is acceptable only for UI-only concerns such as dialog open state, loading flags, selected tabs, or transient search input.

**Delta patch saves (playbook):** when `PLAYBOOK_DELTA_AUTOSAVE_ENABLED` is on, autosave sends `PATCH /playbooks/:id/delta` with only changed fields instead of the full object. Fall back to full save on 4xx/5xx. The autosave XState machine manages the retry/fallback logic.

When adding a new editable field to an autosaved editor, update all layers in one change: frontend type, draft initialization, change handler/draft patch, save payload, backend DTO/schema/serializer when persisted, and tests where the editor has coverage.

## UI & Styling

- Use primitives in `src/components/ui/` first. New primitives go there, not into a module.
- Merge classNames with `cn()` from `@/lib/utils` (runs `clsx` then `tailwind-merge`).
- Variants via CVA (`class-variance-authority`), expose `VariantProps<typeof …>` on props.
- `asChild` (Radix Slot) preferred over wrapping.
- Theming: light/dark via class on `<html>`. Color themes: `default | yellowsys | claude | kpmg` in `COLOR_THEMES`. Use Tailwind semantic tokens (`bg-primary`, `text-muted-foreground`), never hardcode brand colors.
- Icons: default to `lucide-react`; brand/custom SVGs in `src/components/icons.tsx` under `<Icons.*>`. `<AppLogo />` is theme-aware.

**Semantic canvas connections:** [SemanticModelCanvas](../../../YellowStorm/front/src/modules/semantic-model/components/editor/SemanticModelCanvas.tsx) exposes separate data and relationship ports with generic input/output labels; its action controls hug the concept circle without covering either port. One local classifier drives both ReactFlow validation and connection routing: new data derivations reject self-connections, protected/system endpoints, fieldless sources, and cycles, while derived concepts remain valid sources for acyclic chains and an exact saved feed remains reopenable. A valid new drag passes its explicit source through [SemanticModelEditorPage](../../../YellowStorm/front/src/modules/semantic-model/pages/SemanticModelEditorPage.tsx) so [DerivedSourceDrawer](../../../YellowStorm/front/src/modules/semantic-model/components/mapping/DerivedSourceDrawer.tsx) initializes the unsaved mapping from that source. Backend payload assembly and runtime normalization independently preserve dependency order for chained population and transitive concept refresh. Focused coverage is in [SemanticModelCanvas.test.tsx](../../../YellowStorm/front/src/modules/semantic-model/components/editor/SemanticModelCanvas.test.tsx) and [DerivedSourceDrawer.test.tsx](../../../YellowStorm/front/src/modules/semantic-model/components/mapping/DerivedSourceDrawer.test.tsx).

**Conversation artifacts:** When viewing an artifact, [ArtifactRow](../../../YellowStorm/front/src/modules/conversation/components/activity/ConversationAssistantBubble.tsx) uses the supplied MIME only when `isViewableFile` accepts it; otherwise it infers from the filename via `getMimeTypeFromFilename`, then falls back to the supplied MIME, then `application/octet-stream`. This supports Markdown, text, CSV, XLSX, PPT/PPTX, PDF, and DOCX filenames; a DOCX filename can override a misleading `application/zip` MIME, while an unknown ZIP filename retains `application/zip`. DOCX rendering remains owned by the existing `DocxRenderer`. Focused behavior coverage is in [ConversationAssistantBubble.test.tsx](../../../YellowStorm/front/src/modules/conversation/components/activity/ConversationAssistantBubble.test.tsx).

### Connector editor guidance

The connector editor uses supplementary help tooltips rather than persistent
instruction paragraphs for editable fields, including nested branding, mapping,
skill selection and worker controls. Persistent labels, validation errors,
credential state and save-before-inspection notices remain visible. Help triggers
must support keyboard focus and pointer access; option help describes the choice
without inserting interactive help buttons inside list options. Dynamic items use
actual descriptions or truthful selection context, not invented capabilities.

`MultiSelect` exposes optional tooltip guidance; callers that do not opt in retain
inline descriptions and existing behavior. In tooltip mode Command highlight, not
DOM focus, selects option guidance while search retains focus. Unique option IDs
distinguish duplicate labels, with label keywords preserving filtering. Native
color-picker internals are browser-owned; the color/hex fields receive guidance.
Slot-based tooltip triggers require ref-capable controls: the shared Switch
forwards its ref to the Radix root. Suppressed MultiSelect help retains a
consistently controlled open state instead of switching between boolean/undefined.
Advanced fieldsets and dynamic rows must shrink or wrap on narrow localized views
rather than force min-content horizontal overflow. Tooltips never replace
connector authorization, revision fencing or actionable error messages.

## Internationalisation (i18n)

**No hardcoded user-facing string. Ever.** Every label, placeholder, tooltip, toast, validation message, and aria-label goes through i18n.

```ts
const { t } = useModuleTranslation('playbook');
return <Button>{t('list.createButton')}</Button>;
```

Namespaces: `common`, `errors`, `auth` always loaded; module namespaces lazy-loaded on first use. Keys are **flat with dot-notation** (`"store.errors.notFound"`). Adding strings: add to `en.json`, `fr.json` and `ar.json`. Shared strings from `common`; error codes resolved automatically by `getErrorMessage(code)`.

**Arabic (ar):** mirror English keys exactly — call sites select plural variants manually, enforced by `locales-parity.test.ts`. Use logical utilities (`ms`/`me`/`ps`/`pe`/`text-start`/`text-end`), never physical `ml`/`mr`/`pl`/`pr`/`text-left`/`text-right`; Arabic sets `dir="rtl"` automatically via `LocalizationProvider`.

## Notifications (Toasts)

Always go through `@/lib/notifications`: `showSuccess`, `showError`, `showWarning`, `showInfo`, `showLoading`, `showPromise`. **Do not** import `toast` from `sonner` directly. The global `<Toaster />` is in `App.tsx` — don't add another.

## Performance

Lazy-load route pages. `useShallow` for multi-field Zustand selectors. Memoise expensive child props with `useMemo`; use `memo` only when a profiler shows hot re-renders. Virtualise long lists with `virtua`. Debounce/throttle high-frequency updates (SSE chunks, resize, search). Avoid large Markdown/code in the critical path.
