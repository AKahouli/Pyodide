export const EMAIL_TEMPLATES_DIR = 'templates';

export const LOGO_CID = 'yellowmind-logo';

export enum EmailTemplate {
  PASSWORD_RESET = 'password-reset',
  VERIFY_EMAIL = 'verify-email',
  NEW_LOGIN_ALERT = 'new-login-alert',
  LINK_OAUTH_ACCOUNT = 'link-oauth-account',
  REGISTRATION_PENDING_ADMIN = 'registration-pending-admin',
  REGISTRATION_APPROVED = 'registration-approved',
}

export interface EmailTemplateConfig {
  file: string;
  subject: string;
}

/**
 * Registry of transactional emails. Each entry maps a template key to its HTML
 * file (a full standalone document) and its (possibly dynamic) subject.
 * Everything rendered via `{{variable}}` placeholders is provided by the
 * calling service at render time; `{{year}}` and `{{appUrl}}` get defaults.
 */
export const EMAIL_TEMPLATES: Record<EmailTemplate, EmailTemplateConfig> = {
  [EmailTemplate.PASSWORD_RESET]: {
    file: 'password-reset.html',
    subject: 'Reset your password - {{appName}}',
  },
  [EmailTemplate.VERIFY_EMAIL]: {
    file: 'verify-email.html',
    subject: 'Verify your email address - {{appName}}',
  },
  [EmailTemplate.NEW_LOGIN_ALERT]: {
    file: 'new-login-alert.html',
    subject: '🔔 New login to your {{appName}} account',
  },
  [EmailTemplate.LINK_OAUTH_ACCOUNT]: {
    file: 'link-oauth-account.html',
    subject: 'Link your {{providerKey}} account - {{appName}}',
  },
  [EmailTemplate.REGISTRATION_PENDING_ADMIN]: {
    file: 'registration-pending-admin.html',
    subject: 'New registration request - {{appName}}',
  },
  [EmailTemplate.REGISTRATION_APPROVED]: {
    file: 'registration-approved.html',
    subject: 'Your account has been approved - {{appName}}',
  },
};