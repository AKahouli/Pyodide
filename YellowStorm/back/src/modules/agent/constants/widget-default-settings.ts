import type { AgentWidgetSettings } from '../interfaces/agent.interface';

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const WIDGET_THEME_PRESETS = [
  'yellowstorm-modern',
  'public-service-light',
  'pold-magenta',
  'neutral-blue',
  'high-contrast-light',
  'dark-modern',
] as const;

const WIDGET_DESKTOP_WIDTHS = [360, 400, 480] as const;
const WIDGET_DESKTOP_HEIGHTS = [520, 620, 720] as const;

export const DEFAULT_WIDGET_SETTINGS: AgentWidgetSettings = {
  version: 1,
  appSourceName: 'Website widget',
  identity: {
    organizationName: '',
    assistantTitle: 'Assistant demarches',
    assistantSubtitle: 'Service d aide en ligne',
    avatarMode: 'initials',
    avatarInitials: 'AD',
  },
  launcher: {
    label: 'Aide en ligne',
    mobileLabel: 'Aide',
    variant: 'pill',
    position: 'bottom-right',
    showUnreadBadge: true,
    showIntroTooltip: false,
    introTooltipText: 'Besoin d aide pour vos demarches ?',
  },
  theme: {
    preset: 'public-service-light',
    customEnabled: false,
    colors: {},
    radius: 'lg',
    density: 'comfortable',
  },
  layout: {
    desktopWidth: 400,
    desktopHeight: 620,
  },
  content: {
    greetingTitle: 'Bonjour, comment puis-je vous aider ?',
    greetingBody: 'Je peux vous aider a trouver une information, comprendre une demarche ou vous orienter vers le bon service.',
    privacyNotice: 'Ne saisissez pas de donnees sensibles dans le chat.',
    footerText: 'Propulse par YellowStorm',
    footerLinks: [],
    suggestions: [
      {
        id: 'find-procedure',
        label: 'Trouver une demarche',
        prompt: 'Je cherche une demarche administrative. Pouvez-vous m orienter ?',
        enabled: true,
        sortOrder: 10,
      },
      {
        id: 'contact-service',
        label: 'Contacter un service',
        prompt: 'Je souhaite contacter le bon service. Pouvez-vous m aider ?',
        enabled: true,
        sortOrder: 20,
      },
      {
        id: 'practical-info',
        label: 'Informations pratiques',
        prompt: 'Je cherche des informations pratiques : horaires, acces ou contacts.',
        enabled: true,
        sortOrder: 30,
      },
    ],
  },
  labels: {
    inputPlaceholder: 'Votre question...',
    sendButton: 'Envoyer le message',
    closeButton: 'Fermer le chat',
    optionsButton: 'Options du chat',
    newConversation: 'Nouvelle conversation',
    copyTranscript: 'Copier la conversation',
    downloadTranscript: 'Telecharger la conversation',
    transcriptCopied: 'Conversation copiee',
    transcriptDownloaded: 'Conversation telechargee',
    emptyTranscript: 'Aucune conversation a copier',
    errorGeneric: 'Desole, une erreur est survenue. Veuillez reessayer.',
    errorReset: 'Impossible de demarrer une nouvelle conversation.',
    typing: 'L assistant redige une reponse',
    sourcesUsedSingular: '1 source utilisee',
    sourcesUsedPlural: '{count} sources utilisees',
    choiceSubmit: 'Envoyer',
    choiceDismiss: 'Passer cette question',
    choiceDismissed: 'Question ignoree',
    choiceDismissMessage: 'Je prefere ne pas repondre a cette question.',
    choiceOtherLabel: 'Autre reponse',
    choiceSendError: 'Impossible d envoyer ce choix. Reessayez.',
    choiceWaitForReply: 'Attendez la fin de la reponse en cours.',
  },
  behavior: {
    defaultOpen: false,
    persistVisitorId: true,
    allowTranscriptCopy: true,
    allowTranscriptDownload: true,
    allowNewConversation: true,
    requirePrivacyNotice: true,
  },
};

export function normalizeWidgetSettings(input?: Partial<AgentWidgetSettings>): AgentWidgetSettings {
  const merged = mergeWidgetSettings(DEFAULT_WIDGET_SETTINGS, sanitizeWidgetSettings(input));
  return {
    ...merged,
    content: {
      ...merged.content,
      suggestions: merged.content.suggestions
        .slice(0, 6)
        .filter((suggestion) => suggestion.label.trim() && suggestion.prompt.trim())
        .sort((a, b) => a.sortOrder - b.sortOrder),
      footerLinks: (merged.content.footerLinks ?? []).filter((link) => isSafeHttpUrl(link.url)).slice(0, 4),
    },
    layout: {
      desktopWidth: isDesktopWidth(merged.layout?.desktopWidth) ? merged.layout.desktopWidth : DEFAULT_WIDGET_SETTINGS.layout.desktopWidth,
      desktopHeight: isDesktopHeight(merged.layout?.desktopHeight) ? merged.layout.desktopHeight : DEFAULT_WIDGET_SETTINGS.layout.desktopHeight,
    },
  };
}

function sanitizeWidgetSettings(input?: Partial<AgentWidgetSettings>): Partial<AgentWidgetSettings> | undefined {
  if (!input) return undefined;
  return {
    ...input,
    theme: input.theme
      ? {
          ...input.theme,
          colors: Object.fromEntries(
            Object.entries(input.theme.colors ?? {}).filter(([, value]) => typeof value === 'string' && HEX_COLOR_PATTERN.test(value)),
          ),
        }
      : undefined,
  };
}

function mergeWidgetSettings(
  base: AgentWidgetSettings,
  input?: Partial<AgentWidgetSettings>,
): AgentWidgetSettings {
  if (!input) return JSON.parse(JSON.stringify(base)) as AgentWidgetSettings;
  return {
    ...base,
    ...input,
    identity: { ...base.identity, ...input.identity },
    launcher: { ...base.launcher, ...input.launcher },
    theme: {
      ...base.theme,
      ...input.theme,
      colors: { ...base.theme.colors, ...(input.theme?.colors ?? {}) },
    },
    layout: { ...base.layout, ...input.layout },
    content: { ...base.content, ...input.content },
    labels: { ...base.labels, ...input.labels },
    behavior: { ...base.behavior, ...input.behavior },
  };
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isDesktopWidth(value: unknown): value is AgentWidgetSettings['layout']['desktopWidth'] {
  return typeof value === 'number' && WIDGET_DESKTOP_WIDTHS.includes(value as (typeof WIDGET_DESKTOP_WIDTHS)[number]);
}

function isDesktopHeight(value: unknown): value is AgentWidgetSettings['layout']['desktopHeight'] {
  return typeof value === 'number' && WIDGET_DESKTOP_HEIGHTS.includes(value as (typeof WIDGET_DESKTOP_HEIGHTS)[number]);
}
