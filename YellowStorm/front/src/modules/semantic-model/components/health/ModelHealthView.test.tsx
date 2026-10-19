import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthConcept, ModelHealth } from '../../types';
import { ModelHealthView } from './ModelHealthView';

const hooks = vi.hoisted(() => ({ useModelHealth: vi.fn() }));
vi.mock('../../query/hooks', () => hooks);

const participation: HealthConcept = {
  conceptId: 'c-part', label: 'Participation', status: 'blocked',
  origin: { kind: 'sheet', sources: ['email.zip › participants'] },
  keyFields: [{ key: 'role', label: 'Rôle' }],
  journey: { unit: 'rows', rowsAvailable: 99900, rowsRead: 99900, recordsMade: 3, dropped: [{ reason: 'same_key', rows: 99897 }] },
  keepRatio: 3 / 99900,
  issues: [{
    id: 'c-part:identity_too_coarse', conceptId: 'c-part', kind: 'identity_too_coarse', cause: 'design', severity: 'blocked',
    params: { concept: 'Participation', keyFields: 'Rôle', keyValues: 3, rows: 99900, records: 3, lostPercent: 99.99, suggested: 'Clé message + Adresse + Rôle' },
    impact: { rows: 99897, of: 99900, values: 295963 },
    breakdown: { kind: 'key_values', items: [{ label: 'destinataire', value: 49900 }, { label: 'expediteur', value: 25000 }] },
    examples: [{ source: 'email.zip', sheet: 'participants', row: 2, values: { 'Clé message': 'msg_23a6e0', Adresse: 'claire.morel@asteria-air.eu' } }],
    forecast: { records: 99900, estimated: true },
    fix: { kind: 'choose_unique_field', conceptId: 'c-part', suggestedFields: ['cle_message', 'adresse', 'role'] },
    secondary: { kind: 'choose_unique_field', conceptId: 'c-part' },
  }],
};
const correspondent: HealthConcept = {
  conceptId: 'c-corr', label: 'Correspondant', status: 'warning',
  origin: { kind: 'derived', sources: [], fromConceptId: 'c-part' }, keyFields: [{ key: 'adresse', label: 'Adresse' }],
  journey: { unit: 'records', rowsAvailable: 3, rowsRead: 3, recordsMade: 3, dropped: [] }, keepRatio: 1,
  issues: [{
    id: 'c-corr:inherited', conceptId: 'c-corr', kind: 'inherited', cause: 'design', severity: 'warning',
    params: { concept: 'Correspondant', upstream: 'Participation' }, impact: {}, examples: [], upstreamConceptId: 'c-part',
    fix: { kind: 'go_to_concept', conceptId: 'c-part' },
  }],
};
const fait: HealthConcept = {
  conceptId: 'c-fait', label: 'Fait', status: 'warning',
  origin: { kind: 'sheet', sources: ['email.zip › messages'] }, keyFields: [{ key: 'description', label: 'Description' }],
  journey: { unit: 'rows', rowsAvailable: 25000, rowsRead: 25000, ai: { read: 500, limit: 500, limited: 24500 }, recordsMade: 471,
    dropped: [{ reason: 'ai_limit', rows: 24500 }, { reason: 'missing_identity', rows: 29, field: 'description' }] },
  keepRatio: 0.019,
  issues: [
    { id: 'c-fait:missing', conceptId: 'c-fait', kind: 'rows_without_key', cause: 'values', severity: 'warning',
      params: { concept: 'Fait', field: 'Description', rows: 29, of: 25000, ai: 1 }, impact: { rows: 29, of: 25000 }, examples: [],
      fix: { kind: 'open_sources', conceptId: 'c-fait' } },
    { id: 'c-fait:ai', conceptId: 'c-fait', kind: 'ai_row_limit', cause: 'limit', severity: 'info',
      params: { concept: 'Fait', limit: 500, read: 500, left: 24500 }, impact: { rows: 24500, of: 25000 },
      breakdown: { kind: 'ai_cost', items: [{ label: '500', value: 500, current: true }, { label: '25000', value: 25000 }] }, examples: [],
      fix: { kind: 'raise_ai_limit', currentLimit: 500, suggestedLimit: 25000 } },
  ],
};
const health = (overrides: Partial<ModelHealth> = {}): ModelHealth => ({
  state: 'ready', dataRevisionId: 'dr-1',
  verdict: { conceptId: 'c-part', issueId: 'c-part:identity_too_coarse', kind: 'identity_too_coarse', params: participation.issues[0].params },
  summary: { concepts: 3, healthy: 0, rowsRead: 124900, recordsKept: 477, fixesNeeded: 2, limits: 1, setupItems: 0 },
  concepts: [participation, correspondent, fait], setup: [], ...overrides,
});

const show = (data: ModelHealth | undefined, state: { isLoading?: boolean; isError?: boolean } = {}, sections: { records?: ReactNode; sources?: ReactNode } = {}) => {
  hooks.useModelHealth.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn(), ...state });
  const onAction = vi.fn();
  render(<ModelHealthView modelId='m-1' canEdit onAction={onAction} setup={<p>setup slot</p>} records={sections.records} sources={sections.sources} />);
  return onAction;
};

describe('ModelHealthView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens on the verdict and the concept that explains it, worst first', () => {
    show(health());
    expect(screen.getByText('health.verdict.identity_too_coarse.title')).toBeInTheDocument();
    const rail = screen.getByRole('navigation', { name: 'health.rail.aria' });
    expect(within(rail).getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('Participation'), expect.stringContaining('Correspondant'), expect.stringContaining('Fait')]);
    // The line under a concept says what happened to its rows.
    expect(within(rail).getByText('health.flow.rowsToRecords')).toBeInTheDocument();
    expect(within(rail).getByText('health.flow.aiToRecords')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Participation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'health.issue.identity_too_coarse.title' })).toBeInTheDocument();
    expect(screen.getByText('setup slot')).toBeInTheDocument();
  });

  it('switches among Overview, Records, and Sources & lineage sections', () => {
    show(health(), {}, { records: <p>record section</p>, sources: <p>source lineage section</p> });

    const tabs = screen.getByRole('tablist', { name: 'trustCenter.sections' });
    expect(within(tabs).getByRole('tab', { name: 'trustCenter.overview' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(tabs).getByRole('tab', { name: 'trustCenter.records' }));
    expect(screen.getByText('record section')).toBeInTheDocument();
    expect(screen.queryByText('setup slot')).not.toBeInTheDocument();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'trustCenter.sourcesLineage' }));
    expect(screen.getByText('source lineage section')).toBeInTheDocument();
  });

  it('shows real rows with where they come from, not a generic record', () => {
    show(health());
    expect(screen.getByText('participants · health.example.row')).toBeInTheDocument();
    expect(screen.getByText('Clé message: msg_23a6e0 · Adresse: claire.morel@asteria-air.eu')).toBeInTheDocument();
    expect(screen.getByText('destinataire')).toBeInTheDocument();
    expect(screen.getByText('health.forecast.records')).toBeInTheDocument();
  });

  it('opens the unique-field editor with the suggested fields instead of changing anything', () => {
    const onAction = show(health());
    fireEvent.click(screen.getByRole('button', { name: 'health.action.choose_unique_field_suggested' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'choose_unique_field', conceptId: 'c-part', suggestedFields: ['cle_message', 'adresse', 'role'] });
    fireEvent.click(screen.getByRole('button', { name: 'health.action.choose_unique_field' }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'choose_unique_field', conceptId: 'c-part' });
  });

  it('sends a derived concept to the one it depends on', () => {
    const onAction = show(health());
    fireEvent.click(screen.getByRole('button', { name: /Correspondant/ }));
    expect(screen.getAllByText('health.status.inherited').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'health.action.go_to_concept' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Participation' })).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('filters the cards of a concept by cause', () => {
    show(health());
    fireEvent.click(screen.getByRole('button', { name: /Fait/ }));
    expect(screen.getByRole('heading', { name: 'health.issue.rows_without_key.title' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'health.issue.ai_row_limit.title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /health\.cause\.limit/ }));
    expect(screen.queryByRole('heading', { name: 'health.issue.rows_without_key.title' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'health.issue.ai_row_limit.title' })).toBeInTheDocument();
    expect(screen.getByText('health.forecast.aiCalls')).toBeInTheDocument();
  });

  it('opens the records of the concept from "See the data"', () => {
    const onAction = show(health());
    fireEvent.click(screen.getByRole('button', { name: 'health.seeData' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'view_records', conceptId: 'c-part' });
  });

  it('keeps a limit the admin set out of the editors: it opens the run limits', () => {
    const onAction = show(health());
    fireEvent.click(screen.getByRole('button', { name: /Fait/ }));
    fireEvent.click(screen.getByRole('button', { name: 'health.action.raise_ai_limit' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'raise_ai_limit', currentLimit: 500, suggestedLimit: 25000 });
  });

  it('says when nothing needs a person', () => {
    show(health({ verdict: null, summary: { concepts: 1, healthy: 1, rowsRead: 10, recordsKept: 10, fixesNeeded: 0, limits: 0, setupItems: 0 },
      concepts: [{ ...participation, status: 'healthy', issues: [], journey: { ...participation.journey, recordsMade: 10, dropped: [] } }] }));
    expect(screen.getByText('health.verdict.clean.title')).toBeInTheDocument();
    expect(screen.getByText('health.empty')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'health.ring.aria' })).toBeInTheDocument();
  });

  it('shows only the setup before any data was prepared, and the loading and error states', () => {
    show({ ...health(), state: 'no_data', concepts: [], verdict: null });
    expect(screen.getByText('health.noData.title')).toBeInTheDocument();
    expect(screen.getByText('setup slot')).toBeInTheDocument();
  });

  it('retries when the report cannot be read', () => {
    const refetch = vi.fn();
    hooks.useModelHealth.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    render(<ModelHealthView modelId='m-1' canEdit onAction={vi.fn()} setup={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'health.retry' }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('ModelHealthView mail archive reading', () => {
  beforeEach(() => vi.clearAllMocks());

  const pieces = (counts: Record<string, number>, limited: number): HealthConcept => ({
    conceptId: 'c-pj', label: 'Pièce jointe', status: 'info',
    origin: { kind: 'sheet', sources: ['email.zip › attachments'] }, keyFields: [{ key: 'cle_piece_jointe', label: 'Clé' }],
    journey: { unit: 'rows', rowsAvailable: 1000, rowsRead: 1000, recordsMade: 1000, dropped: [] }, keepRatio: 1,
    issues: [{
      id: 'c-pj:archive_reading:attachments', conceptId: 'c-pj', kind: 'archive_reading', cause: limited > 0 ? 'limit' : 'values', severity: 'info',
      params: { concept: 'Pièce jointe', sheet: 'attachments', total: 1000, affected: 100, limited },
      impact: { rows: 100, of: 1000 },
      breakdown: { kind: 'reading', items: Object.entries(counts).map(([label, value]) => ({ label, value })) },
      examples: [], ...(limited > 0 ? { fix: { kind: 'open_run_limits' as const } } : {}),
    }],
  });

  it('names each outcome of the reading, and points to the run limits only when a limit cut something', () => {
    show(health({ verdict: null, concepts: [pieces({ extracted: 900, truncated: 60, scanned: 40 }, 60)] }));
    expect(screen.getByRole('heading', { name: 'health.issue.archive_reading.title' })).toBeInTheDocument();
    expect(screen.getByText('health.issue.archive_reading.whyLimit')).toBeInTheDocument();
    for (const outcome of ['extracted', 'truncated', 'scanned']) {
      expect(screen.getByText(`health.issue.archive_reading.category.${outcome}`)).toBeInTheDocument();
    }
    expect(screen.getByText('health.fix.open_run_limits')).toBeInTheDocument();
  });

  it('says no limit explains a reading that only has scans and unknown formats', () => {
    show(health({ verdict: null, concepts: [pieces({ extracted: 960, scanned: 30, unsupported: 10 }, 0)] }));
    expect(screen.getByText('health.issue.archive_reading.whyFiles')).toBeInTheDocument();
    expect(screen.queryByText('health.fix.open_run_limits')).not.toBeInTheDocument();
  });
});
