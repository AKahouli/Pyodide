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
    copyMessage: 'Copier le message',
    downloadTranscript: 'Telecharger la conversation',
    transcriptCopied: 'Conversation copiee',
    messageCopied: 'Message copie',
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
    accessibilitySettings: 'Reglages accessibilite',
    accessibilitySettingsTitle: 'Reglages accessibilite',
    accessibilitySettingsDescription: 'Choisissez un profil d affichage. Ce choix est enregistre uniquement dans ce navigateur.',
    accessibilityProfile: 'Profil accessibilite',
    accessibilityClose: 'Fermer les reglages accessibilite',
    accessibilityReset: 'Utiliser le profil par defaut',
    microphoneStart: 'Demarrer la saisie vocale',
    microphoneUnavailable: 'La saisie vocale n est pas disponible dans ce navigateur',
    microphoneListening: 'Ecoute en cours. La saisie vocale est traitee par votre navigateur.',
    readAloud: 'Lire a voix haute',
    stopReading: 'Arreter la lecture',
    readAloudUnavailable: 'La lecture a voix haute n est pas disponible dans ce navigateur',
  },
  behavior: {
    defaultOpen: false,
    persistVisitorId: true,
    allowTranscriptCopy: true,
    allowTranscriptDownload: true,
    allowNewConversation: true,
    requirePrivacyNotice: true,
  },
  accessibility: {
    enabled: true, showSettingsButton: true, defaultProfile: 'standard',
    availableProfiles: ['standard', 'low-vision', 'high-contrast-light', 'high-contrast-dark', 'cognitive-comfort', 'motor-assistance', 'low-stimulation'],
    allowTextResize: true, allowLineSpacing: true, allowLetterSpacing: true, allowFontSelection: true, allowLinkUnderlining: true, allowHighContrast: true, allowCustomAccessibleColors: false, allowMotionControl: true, allowLargeTargets: true, allowSimplifiedMode: true, allowEnhancedFocus: true,
    enforceMinimumContrast: true, minimumTextContrastRatio: 4.5, minimumUiContrastRatio: 3,
    voiceInput: { enabled: true, language: 'auto', continuous: false, interimResults: true, autoPunctuation: true, autoSend: false, stopAfterSilenceMs: 3000, retainAudio: false },
    readAloud: { enabled: true, autoPlay: false, defaultRate: 1, highlightCurrentSentence: true, readSourcesByDefault: false },
    screenReader: { announceStreaming: true, announcementIntervalMs: 1500, announceChoices: true, announceSources: false, announceCompletion: true },
    keyboard: { shortcutsEnabled: true, microphoneShortcut: 'Alt+Shift+M', accessibilityPanelShortcut: 'Alt+Shift+A', readAloudShortcut: 'Alt+Shift+R' },
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
    accessibility: normalizeAccessibilitySettings(merged.accessibility),
  };
}

const ACCESSIBILITY_PROFILES = ['standard', 'low-vision', 'high-contrast-light', 'high-contrast-dark', 'cognitive-comfort', 'motor-assistance', 'low-stimulation'] as const;

function normalizeAccessibilitySettings(value: AgentWidgetSettings['accessibility']): AgentWidgetSettings['accessibility'] {
  const defaults = DEFAULT_WIDGET_SETTINGS.accessibility;
  const profiles = Array.from(new Set((value.availableProfiles ?? []).filter((profile): profile is typeof ACCESSIBILITY_PROFILES[number] => ACCESSIBILITY_PROFILES.includes(profile as typeof ACCESSIBILITY_PROFILES[number]))));
  const availableProfiles = profiles.length ? profiles : defaults.availableProfiles;
  const defaultProfile = availableProfiles.includes(value.defaultProfile) ? value.defaultProfile : defaults.defaultProfile;
  return {
    ...defaults, ...value, availableProfiles, defaultProfile,
    minimumTextContrastRatio: clamp(value.minimumTextContrastRatio, 1, 21, defaults.minimumTextContrastRatio),
    minimumUiContrastRatio: clamp(value.minimumUiContrastRatio, 1, 21, defaults.minimumUiContrastRatio),
    voiceInput: { ...defaults.voiceInput, ...value.voiceInput, autoSend: false, retainAudio: false, stopAfterSilenceMs: clamp(value.voiceInput?.stopAfterSilenceMs, 1000, 15000, defaults.voiceInput.stopAfterSilenceMs) },
    readAloud: { ...defaults.readAloud, ...value.readAloud, autoPlay: false, defaultRate: clamp(value.readAloud?.defaultRate, 0.5, 2, defaults.readAloud.defaultRate) },
    screenReader: { ...defaults.screenReader, ...value.screenReader, announcementIntervalMs: clamp(value.screenReader?.announcementIntervalMs, 500, 5000, defaults.screenReader.announcementIntervalMs) },
    keyboard: { ...defaults.keyboard, ...value.keyboard },
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
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
    accessibility: {
      ...base.accessibility, ...input.accessibility,
      voiceInput: { ...base.accessibility.voiceInput, ...input.accessibility?.voiceInput },
      readAloud: { ...base.accessibility.readAloud, ...input.accessibility?.readAloud },
      screenReader: { ...base.accessibility.screenReader, ...input.accessibility?.screenReader },
      keyboard: { ...base.accessibility.keyboard, ...input.accessibility?.keyboard },
    },
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
