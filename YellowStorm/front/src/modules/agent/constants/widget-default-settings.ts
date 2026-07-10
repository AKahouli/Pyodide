import type { AgentDeploymentSettings, AgentWidgetSettings } from '../types';

export const DEFAULT_WIDGET_SETTINGS = {
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
  },
  behavior: {
    defaultOpen: false,
    persistVisitorId: true,
    allowTranscriptCopy: true,
    allowTranscriptDownload: true,
    allowNewConversation: true,
    requirePrivacyNotice: true,
  },
} satisfies AgentWidgetSettings;

export function mergeWidgetSettings(value?: Partial<AgentWidgetSettings>): AgentWidgetSettings {
  return {
    ...DEFAULT_WIDGET_SETTINGS,
    ...value,
    identity: { ...DEFAULT_WIDGET_SETTINGS.identity, ...value?.identity },
    launcher: { ...DEFAULT_WIDGET_SETTINGS.launcher, ...value?.launcher },
    theme: {
      ...DEFAULT_WIDGET_SETTINGS.theme,
      ...value?.theme,
      colors: { ...DEFAULT_WIDGET_SETTINGS.theme.colors, ...(value?.theme?.colors ?? {}) },
    },
    layout: { ...DEFAULT_WIDGET_SETTINGS.layout, ...value?.layout },
    content: { ...DEFAULT_WIDGET_SETTINGS.content, ...value?.content },
    labels: { ...DEFAULT_WIDGET_SETTINGS.labels, ...value?.labels },
    behavior: { ...DEFAULT_WIDGET_SETTINGS.behavior, ...value?.behavior },
  };
}

export const DEFAULT_DEPLOYMENT_SETTINGS = {
  embedEnabled: false,
  restEnabled: false,
  widget: DEFAULT_WIDGET_SETTINGS,
} satisfies AgentDeploymentSettings;
