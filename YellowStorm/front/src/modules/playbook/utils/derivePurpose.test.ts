import { describe, expect, it } from 'vitest';
import { derivePurpose } from './derivePurpose';

const PILOTAGE_PROMPT = `# Prompt de construction du Playbook

## Rôle

Tu es un expert en pilotage financier et en consolidation budgétaire. Tu connais les normes de reporting CFO.

## Objectif métier

Ce playbook automatise le suivi du pilotage financier 2026 en consolidant les écarts entre budget et réalisations pour la direction financière. Il produit un rapport mensuel d'atterrissage.

## Mission

Ta mission est d'orchestrer la collecte des données financières.`;

const CRISIS_ROOM_PROMPT = `# Prompt de construction

## 1. Mission du constructeur

Construire une salle de crise qui agrège les alertes de sécurité et propose un plan de réponse coordonné. La synthèse est envoyée au responsable sécurité.

## 2. Étapes

- Détecter les injections
- Alertes et remontées`;

describe('derivePurpose', () => {
  it('returns empty for an empty description', () => {
    expect(derivePurpose('')).toEqual({ purpose: '', purposeIsDerived: false });
    expect(derivePurpose(null)).toEqual({ purpose: '', purposeIsDerived: false });
    expect(derivePurpose('   ')).toEqual({ purpose: '', purposeIsDerived: false });
  });

  it('returns the first sentence of a clean one-line description', () => {
    expect(derivePurpose('Create a lead gen playbook. It does more things after.')).toEqual({
      purpose: 'Create a lead gen playbook.',
      purposeIsDerived: false,
    });
  });

  it('extracts from the Objectif section of a construction prompt (Pilotage financier case)', () => {
    const { purpose, purposeIsDerived } = derivePurpose(PILOTAGE_PROMPT);
    expect(purposeIsDerived).toBe(true);
    expect(purpose).toContain('pilotage financier 2026');
    expect(purpose).not.toContain('Prompt de construction');
    expect(purpose.length).toBeLessThanOrEqual(160);
  });

  it('skips the heading itself when extracting (Crisis Room case)', () => {
    const { purpose, purposeIsDerived } = derivePurpose(CRISIS_ROOM_PROMPT);
    expect(purposeIsDerived).toBe(true);
    expect(purpose).not.toContain('Mission du constructeur');
    expect(purpose).not.toContain('#');
    expect(purpose).toMatch(/^Construire une salle de crise/);
  });

  it('returns empty for a description that is only headings', () => {
    expect(derivePurpose('# Titre\n\n## Sous-titre\n\n### Autre')).toEqual({
      purpose: '',
      purposeIsDerived: false,
    });
  });

  it('returns empty for a long prompt dump with no objective section (no fallback to first 160 chars)', () => {
    const dump = 'Tu es un assistant générique. '.repeat(40);
    const result = derivePurpose(dump);
    expect(result).toEqual({ purpose: '', purposeIsDerived: false });
  });

  it('never leaks markdown syntax into the purpose line', () => {
    const { purpose } = derivePurpose('Un playbook **important** avec un [lien](http://x.fr) et du `code` dedans. Suite.');
    expect(purpose).not.toMatch(/[*_`[\]]/);
    expect(purpose).toContain('lien');
  });

  it('clamps long clean descriptions at a word boundary', () => {
    const long = `${'word '.repeat(60)}.`;
    const { purpose } = derivePurpose(long);
    expect(purpose.length).toBeLessThanOrEqual(160);
    expect(purpose.endsWith(' ')).toBe(false);
  });
});
