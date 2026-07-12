import type { AgentWidgetSettings } from '../../types';
import { WIDGET_THEME_COLORS } from '../../constants/widget-theme-presets';

interface WidgetLivePreviewProps {
  settings: AgentWidgetSettings;
  title: string;
}

export function WidgetLivePreview({ settings, title }: WidgetLivePreviewProps) {
  const colors = {
    ...WIDGET_THEME_COLORS[settings.theme.preset],
    ...(settings.theme.customEnabled ? settings.theme.colors : {}),
  };
  const suggestions = settings.content.suggestions.filter((item) => item.enabled).slice(0, 4);
  const radius = { sm: 12, md: 16, lg: 18, xl: 20 }[settings.theme.radius];

  return (
    <div className="rounded-lg border bg-muted/30 p-3" aria-label={title}>
      <div className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium shadow-sm" style={{ background: colors.launcherBackground, color: colors.launcherForeground }}>
        <span className="h-2 w-2 rounded-full bg-current" />
        {settings.launcher.variant === 'pill' ? settings.launcher.label : settings.launcher.mobileLabel || settings.launcher.label}
      </div>
      <div className="overflow-hidden border text-sm shadow-sm" style={{ background: colors.surface, borderColor: colors.border, color: colors.text, borderRadius: radius }}>
        <div className="flex items-center gap-3 p-3" style={{ background: colors.headerBackground, color: colors.headerForeground }}>
          {settings.identity.avatarMode !== 'none' && (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/25 bg-white/15 text-xs font-semibold">
              {settings.identity.avatarInitials || 'AD'}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{settings.identity.assistantTitle}</p>
            <p className="truncate text-xs opacity-80">{settings.identity.assistantSubtitle}</p>
          </div>
          {settings.accessibility.enabled && settings.accessibility.showSettingsButton && <span className="ml-auto rounded-md border border-white/30 px-2 py-1 text-xs">{settings.labels.accessibilitySettings}</span>}
        </div>
        <div className="space-y-3 p-4" style={{ background: colors.background }}>
          {settings.identity.organizationName && <p className="text-xs font-medium uppercase tracking-wide" style={{ color: colors.mutedText }}>{settings.identity.organizationName}</p>}
          <div>
            <p className="text-base font-semibold">{settings.content.greetingTitle}</p>
            {settings.content.greetingBody && <p className="mt-1 text-xs leading-5" style={{ color: colors.mutedText }}>{settings.content.greetingBody}</p>}
          </div>
          <div className="grid gap-2">
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className="rounded-lg border px-3 py-2 text-xs" style={{ background: colors.surface, borderColor: colors.border }}>
                {suggestion.label}
              </div>
            ))}
          </div>
          {settings.content.privacyNotice && <p className="text-xs" style={{ color: colors.mutedText }}>{settings.content.privacyNotice}</p>}
          <div className="flex justify-end">
            <span className="rounded-2xl px-3 py-2 text-xs" style={{ background: colors.userBubble, color: colors.userBubbleText }}>{settings.labels.inputPlaceholder}</span>
          </div>
          <div className="rounded-2xl border px-3 py-2 text-xs" style={{ background: colors.assistantBubble, color: colors.assistantBubbleText, borderColor: colors.border }}>
            {settings.labels.typing}
          </div>
          <div className="flex items-center gap-1 text-xs" style={{ color: colors.mutedText }}>
            <span>12:19</span>
            {settings.accessibility.readAloud.enabled && <span className="inline-flex h-7 w-7 items-center justify-center rounded-md" title={settings.labels.readAloud}>◖</span>}
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md" title={settings.labels.copyTranscript}>▣</span>
          </div>
          {settings.accessibility.voiceInput.enabled && (
            <div className="flex justify-end">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border" style={{ borderColor: colors.border }} title={settings.labels.microphoneStart}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21H8v2h8v-2h-3v-3.08A7 7 0 0 0 19 11h-2Z" /></svg>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
