import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { DocumentFieldSuggestions } from './DocumentFieldSuggestions';
import type { SemanticNodeType } from '../../types';

const suggest = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ semanticModelApi: { suggestDocumentFields: suggest } }));
vi.mock('../../store', () => ({ waitForGraphSave: vi.fn().mockResolvedValue(undefined) }));
const concept: SemanticNodeType = { id: 'contract', key: 'contract', label: 'Contract', description: 'Loan contracts', attributes: [],
  aliases: [], category: 'business_object', recordPolicy: 'optional', systemKey: null, position: { x: 0, y: 0 } };

describe('DocumentFieldSuggestions review', () => {
  it('keeps metadata text, discards rules after type edits, and preserves the reviewed AI instruction', async () => {
    suggest.mockResolvedValue({ documentsRead: 1, documentsRequested: 1, unread: [], truncated: false, suggestions: [
      { key: 'filename', label: 'Filename', type: 'text', description: 'Source file', mapping: { mode: 'metadata', sourceField: 'document_name', targetAttribute: 'filename' }, evidence: [], matchedDocuments: 1 },
      { key: 'amount', label: 'Amount', type: 'text', description: 'Loan amount', mapping: { mode: 'extract', targetAttribute: 'amount', sourceField: 'Nominal', extractionStrategy: 'deterministic', rules: { labels: ['Nominal'], location: 'auto' }, semanticDefinition: 'Read the nominal amount; return a number without a currency symbol.' }, evidence: [], matchedDocuments: 1 },
    ] });
    const apply = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><DocumentFieldSuggestions modelId='model' concept={concept}
      sources={[{ workspaceId: 'ws', documentId: 'doc', name: 'Loan.pdf', kind: 'document', mimeType: 'application/pdf', path: '' }]}
      onApply={apply} onEvidence={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'fieldDiscovery.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'fieldDiscovery.analyze' }));
    await screen.findByDisplayValue('Amount');
    expect(apply).not.toHaveBeenCalled();
    const types = screen.getAllByRole('combobox', { name: 'fieldDiscovery.typeFor' });
    expect(types[0]).toBeDisabled();
    fireEvent.click(types[1]);
    fireEvent.click(screen.getByRole('option', { name: 'attribute.type.number' }));
    expect(screen.getByDisplayValue('Read the nominal amount; return a number without a currency symbol.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'fieldDiscovery.apply' }));
    const fields = apply.mock.calls[0][0];
    expect(fields[0].mapping).toMatchObject({ mode: 'metadata', sourceField: 'document_name' });
    expect(fields[1]).toMatchObject({ type: 'number', description: 'Read the nominal amount; return a number without a currency symbol.', mapping: { extractionStrategy: 'ai' } });
    expect(fields[1].mapping).not.toHaveProperty('rules');
  });
});
