import { describe, expect, it } from 'vitest';
import en from './en.json';
import fr from './fr.json';

const readinessKeys = [
  'audience_configured',
  'ownership_assigned',
  'guardrails_reviewed',
  'published_agent_roster_valid',
  'published_workspace_set_valid',
] as const;

describe('governance readiness locales', () => {
  it.each([['en', en], ['fr', fr]])('defines named readiness checks and blockers in %s', (_language, locale) => {
    readinessKeys.forEach((key) => {
      expect(locale[`scopeShell.checks.${key}`]).toBeTruthy();
      expect(locale[`scopeShell.blockers.${key}`]).toBeTruthy();
    });
  });
});
