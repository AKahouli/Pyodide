import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AiFieldSettings, withoutAiSettings } from './AiFieldSettings';

const fetchAgents = vi.fn();
vi.mock('@/modules/agent', () => ({
  useAgents: () => [{ id: 'agent-7', name: 'Contracts reader' }],
  useAgentStore: { getState: () => ({ isInitialized: false, isLoading: false, fetchAgents }) },
}));

const field = { sourceField: null, targetAttribute: 'number', mode: 'extract' as const, extractionStrategy: 'ai' as const };

describe('AiFieldSettings', () => {
  it('starts folded, sums up the concept description and the default agent, and loads the agents', () => {
    render(<MemoryRouter><AiFieldSettings fieldLabel='Number' mapping={field} attributeDescription='The contract reference' onChange={vi.fn()} /></MemoryRouter>);
    const header = screen.getByRole('button', { name: /mapping\.aiField\.title/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveTextContent('mapping.aiField.fromDescription · mapping.aiField.defaultAgent');
    expect(fetchAgents).toHaveBeenCalled();
  });

  it('offers the concept description as placeholder and reports a typed definition', () => {
    const onChange = vi.fn();
    render(<MemoryRouter><AiFieldSettings fieldLabel='Number' mapping={field} attributeDescription='The contract reference' onChange={onChange} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.aiField\.title/ }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.aiField.definition' }));
    const box = screen.getByRole('textbox', { name: 'mapping.aiField.definitionFor' });
    expect(box).toHaveAttribute('placeholder', 'The contract reference');
    fireEvent.change(box, { target: { value: 'On the cover page' } });
    expect(onChange).toHaveBeenCalledWith({ semanticDefinition: 'On the cover page', agentId: undefined });
  });

  it('names the chosen agent and links to its page', () => {
    render(<MemoryRouter><AiFieldSettings fieldLabel='Number' mapping={{ ...field, agentId: 'agent-7' }} onChange={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /mapping\.aiField\.title/ }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.aiField.agent' }));
    expect(screen.getByRole('link', { name: /mapping\.aiField\.openAgent/ })).toHaveAttribute('href', '/agents?edit=agent-7');
    expect(screen.getByText('mapping.aiField.agentNotice')).toBeInTheDocument();
  });

  it('drops the AI settings of a field', () => {
    expect(withoutAiSettings({ ...field, semanticDefinition: 'x', agentId: 'y' })).toEqual(field);
  });
});
