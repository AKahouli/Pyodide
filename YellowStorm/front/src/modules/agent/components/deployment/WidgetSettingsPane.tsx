import { ChevronDown, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useModuleTranslation } from '@/modules/localization';
import { DEFAULT_WIDGET_SETTINGS } from '../../constants/widget-default-settings';
import { WIDGET_THEME_COLORS, WIDGET_THEME_PRESETS } from '../../constants/widget-theme-presets';
import type { AgentWidgetSettings } from '../../types';
import { WidgetLivePreview } from './WidgetLivePreview';
import { WidgetSuggestionEditor } from './WidgetSuggestionEditor';

interface WidgetSettingsPaneProps {
  value: AgentWidgetSettings;
  onChange: (value: AgentWidgetSettings) => void;
}

const COLOR_FIELDS = ['primary', 'headerBackground', 'launcherBackground', 'background', 'surface', 'text', 'border', 'userBubble', 'assistantBubble', 'focusRing'] as const;
const DESKTOP_WIDTHS = [360, 400, 480] as const;
const DESKTOP_HEIGHTS = [520, 620, 720] as const;

export function WidgetSettingsPane({ value, onChange }: WidgetSettingsPaneProps) {
  const { t } = useModuleTranslation('agent');
  const update = (patch: Partial<AgentWidgetSettings>) => onChange({ ...value, ...patch });
  const updateIdentity = (patch: Partial<AgentWidgetSettings['identity']>) => update({ identity: { ...value.identity, ...patch } });
  const updateLauncher = (patch: Partial<AgentWidgetSettings['launcher']>) => update({ launcher: { ...value.launcher, ...patch } });
  const updateTheme = (patch: Partial<AgentWidgetSettings['theme']>) => update({ theme: { ...value.theme, ...patch } });
  const updateLayout = (patch: Partial<AgentWidgetSettings['layout']>) => update({ layout: { ...value.layout, ...patch } });
  const updateContent = (patch: Partial<AgentWidgetSettings['content']>) => update({ content: { ...value.content, ...patch } });
  const updateLabels = (patch: Partial<AgentWidgetSettings['labels']>) => update({ labels: { ...value.labels, ...patch } });
  const updateBehavior = (patch: Partial<AgentWidgetSettings['behavior']>) => update({ behavior: { ...value.behavior, ...patch } });

  return (
    <Collapsible defaultOpen className="rounded-md border bg-background">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="flex w-full justify-between rounded-none px-4 py-3">
          <span>{t('createEdit.widget.title')}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-5 border-t p-4">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          {t('createEdit.widget.corsReminder')}
        </p>

        <section className="grid gap-3 md:grid-cols-2">
          <Field label={t('createEdit.widget.appSourceName')}><Input aria-label={t('createEdit.widget.appSourceName')} value={value.appSourceName} maxLength={120} onChange={(event) => update({ appSourceName: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.organizationName')}><Input aria-label={t('createEdit.widget.organizationName')} value={value.identity.organizationName ?? ''} maxLength={120} onChange={(event) => updateIdentity({ organizationName: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.assistantTitle')}><Input aria-label={t('createEdit.widget.assistantTitle')} value={value.identity.assistantTitle} maxLength={120} onChange={(event) => updateIdentity({ assistantTitle: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.assistantSubtitle')}><Input aria-label={t('createEdit.widget.assistantSubtitle')} value={value.identity.assistantSubtitle ?? ''} maxLength={160} onChange={(event) => updateIdentity({ assistantSubtitle: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.avatarMode')}>
            <Select value={value.identity.avatarMode} onValueChange={(avatarMode: AgentWidgetSettings['identity']['avatarMode']) => updateIdentity({ avatarMode })}>
              <SelectTrigger aria-label={t('createEdit.widget.avatarMode')}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="initials">{t('createEdit.widget.avatarInitialsMode')}</SelectItem><SelectItem value="icon">{t('createEdit.widget.avatarIconMode')}</SelectItem><SelectItem value="none">{t('createEdit.widget.avatarNoneMode')}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label={t('createEdit.widget.avatarInitials')}><Input aria-label={t('createEdit.widget.avatarInitials')} value={value.identity.avatarInitials ?? ''} maxLength={4} onChange={(event) => updateIdentity({ avatarInitials: event.target.value.toUpperCase() })} /></Field>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <Field label={t('createEdit.widget.themePreset')}>
            <Select value={value.theme.preset} onValueChange={(preset: AgentWidgetSettings['theme']['preset']) => updateTheme({ preset, colors: value.theme.customEnabled ? value.theme.colors : {} })}>
              <SelectTrigger aria-label={t('createEdit.widget.themePreset')}><SelectValue /></SelectTrigger>
              <SelectContent>{WIDGET_THEME_PRESETS.map((preset) => <SelectItem key={preset} value={preset}>{t(`createEdit.widget.theme.${preset}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('createEdit.widget.radius')}>
            <Select value={value.theme.radius} onValueChange={(radius: AgentWidgetSettings['theme']['radius']) => updateTheme({ radius })}>
              <SelectTrigger aria-label={t('createEdit.widget.radius')}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="sm">{t('createEdit.widget.radiusSm')}</SelectItem><SelectItem value="md">{t('createEdit.widget.radiusMd')}</SelectItem><SelectItem value="lg">{t('createEdit.widget.radiusLg')}</SelectItem><SelectItem value="xl">{t('createEdit.widget.radiusXl')}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Toggle label={t('createEdit.widget.customColors')} checked={value.theme.customEnabled} onCheckedChange={(customEnabled) => updateTheme({ customEnabled })} />
          <Button type="button" variant="outline" onClick={() => updateTheme({ colors: WIDGET_THEME_COLORS[value.theme.preset], customEnabled: true })}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />{t('createEdit.widget.resetPresetColors')}
          </Button>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <Field label={t('createEdit.widget.position')}>
            <Select value={value.launcher.position} onValueChange={(position: AgentWidgetSettings['launcher']['position']) => updateLauncher({ position })}>
              <SelectTrigger aria-label={t('createEdit.widget.position')}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="bottom-right">{t('createEdit.widget.positionBottomRight')}</SelectItem><SelectItem value="bottom-left">{t('createEdit.widget.positionBottomLeft')}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label={t('createEdit.widget.desktopWidth')}>
            <Select value={String(value.layout.desktopWidth)} onValueChange={(desktopWidth) => updateLayout({ desktopWidth: Number(desktopWidth) as AgentWidgetSettings['layout']['desktopWidth'] })}>
              <SelectTrigger aria-label={t('createEdit.widget.desktopWidth')}><SelectValue /></SelectTrigger>
              <SelectContent>{DESKTOP_WIDTHS.map((width) => <SelectItem key={width} value={String(width)}>{width} px</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('createEdit.widget.desktopHeight')}>
            <Select value={String(value.layout.desktopHeight)} onValueChange={(desktopHeight) => updateLayout({ desktopHeight: Number(desktopHeight) as AgentWidgetSettings['layout']['desktopHeight'] })}>
              <SelectTrigger aria-label={t('createEdit.widget.desktopHeight')}><SelectValue /></SelectTrigger>
              <SelectContent>{DESKTOP_HEIGHTS.map((height) => <SelectItem key={height} value={String(height)}>{height} px</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </section>

        {value.theme.customEnabled && (
          <section className="grid gap-3 md:grid-cols-2">
            {COLOR_FIELDS.map((field) => <Field key={field} label={t(`createEdit.widget.color.${field}`)}><Input aria-label={t(`createEdit.widget.color.${field}`)} type="text" value={value.theme.colors[field] ?? ''} placeholder={WIDGET_THEME_COLORS[value.theme.preset][field]} onChange={(event) => updateTheme({ colors: { ...value.theme.colors, [field]: event.target.value } })} /></Field>)}
          </section>
        )}

        <section className="grid gap-3">
          <Field label={t('createEdit.widget.greetingTitle')}><Input aria-label={t('createEdit.widget.greetingTitle')} value={value.content.greetingTitle} maxLength={160} onChange={(event) => updateContent({ greetingTitle: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.greetingBody')}><Textarea aria-label={t('createEdit.widget.greetingBody')} value={value.content.greetingBody ?? ''} maxLength={1000} rows={3} onChange={(event) => updateContent({ greetingBody: event.target.value })} /></Field>
          <WidgetSuggestionEditor suggestions={value.content.suggestions} onChange={(suggestions) => updateContent({ suggestions })} labels={{ title: t('createEdit.widget.suggestions'), add: t('createEdit.widget.addSuggestion'), remove: t('createEdit.widget.removeSuggestion'), enabled: t('createEdit.widget.enabled'), label: t('createEdit.widget.suggestionLabel'), prompt: t('createEdit.widget.suggestionPrompt'), limit: t('createEdit.widget.suggestionsLimit') }} />
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <Field label={t('createEdit.widget.launcherLabel')}><Input aria-label={t('createEdit.widget.launcherLabel')} value={value.launcher.label} maxLength={80} onChange={(event) => updateLauncher({ label: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.inputPlaceholder')}><Input aria-label={t('createEdit.widget.inputPlaceholder')} value={value.labels.inputPlaceholder} maxLength={120} onChange={(event) => updateLabels({ inputPlaceholder: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.newConversation')}><Input aria-label={t('createEdit.widget.newConversation')} value={value.labels.newConversation} maxLength={120} onChange={(event) => updateLabels({ newConversation: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.errorGeneric')}><Input aria-label={t('createEdit.widget.errorGeneric')} value={value.labels.errorGeneric} maxLength={120} onChange={(event) => updateLabels({ errorGeneric: event.target.value })} /></Field>
        </section>

        <section className="grid gap-3">
          <Field label={t('createEdit.widget.privacyNotice')}><Textarea aria-label={t('createEdit.widget.privacyNotice')} value={value.content.privacyNotice ?? ''} maxLength={500} rows={2} onChange={(event) => updateContent({ privacyNotice: event.target.value })} /></Field>
          <Field label={t('createEdit.widget.footerText')}><Input aria-label={t('createEdit.widget.footerText')} value={value.content.footerText ?? ''} maxLength={200} onChange={(event) => updateContent({ footerText: event.target.value })} /></Field>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <Toggle label={t('createEdit.widget.defaultOpen')} checked={value.behavior.defaultOpen} onCheckedChange={(defaultOpen) => updateBehavior({ defaultOpen })} />
          <Toggle label={t('createEdit.widget.allowNewConversation')} checked={value.behavior.allowNewConversation} onCheckedChange={(allowNewConversation) => updateBehavior({ allowNewConversation })} />
          <Toggle label={t('createEdit.widget.allowTranscriptCopy')} checked={value.behavior.allowTranscriptCopy} onCheckedChange={(allowTranscriptCopy) => updateBehavior({ allowTranscriptCopy })} />
          <Toggle label={t('createEdit.widget.allowTranscriptDownload')} checked={value.behavior.allowTranscriptDownload} onCheckedChange={(allowTranscriptDownload) => updateBehavior({ allowTranscriptDownload })} />
        </section>

        <WidgetLivePreview settings={value} title={t('createEdit.widget.preview')} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}

function Toggle({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"><Label>{label}</Label><Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} /></div>;
}
