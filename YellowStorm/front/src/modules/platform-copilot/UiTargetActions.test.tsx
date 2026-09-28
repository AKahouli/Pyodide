import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageComponent } from '@/modules/conversation/types';
import { ConversationUiTargets, collectUiTargets } from './UiTargetActions';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: '/conversation/c-1' }),
}));
vi.mock('@/modules/semantic-model/components/assistant/SourceSuggestions', () => ({
  SourceSuggestionsCard: ({ modelName }: { modelName?: string }) => <p>suggestions for {modelName}</p>,
}));
vi.mock('@/modules/playbook/components/assistant/PlaybookRunStatus', () => ({
  PlaybookRunStatus: ({ executionId }: { executionId: string }) => <p>status of {executionId}</p>,
}));

const editor = { surface: 'semanticModel.editor', params: { modelId: 'model-1', modelName: 'Billing & Contracts' } };
const tool = (data: Record<string, unknown>) => ({ id: String(Math.random()), type: 'toolActivity', data: { toolName: 'apply_model_changes', status: 'completed', ...data } }) as unknown as MessageComponent;

describe('conversation buttons from tools', () => {
  it('reads saved buttons and live results, once per model', () => {
    const targets = collectUiTargets([
      tool({ uiTargets: [editor] }),
      tool({ resultJson: JSON.stringify({ ok: true, data: { uiTarget: editor } }) }),
      tool({ resultJson: JSON.stringify({ data: { uiTarget: { surface: 'semanticModel.sources', params: { modelId: 'model-1', modelName: 'Billing & Contracts' } } } }) }),
      { id: 't', type: 'text', data: { content: 'hi' } } as unknown as MessageComponent,
    ]);
    expect(targets.map((target) => target.surface)).toEqual(['semanticModel.editor', 'semanticModel.sources']);
  });

  it('names the model on its button and opens it', () => {
    render(<ConversationUiTargets targets={collectUiTargets([tool({ uiTargets: [editor] })])} />);
    fireEvent.click(screen.getByRole('button', { name: /navigation.openModel/ }));
    expect(navigate).toHaveBeenCalledWith('/semantic-models/model-1');
  });

  it('names the playbook on its buttons, and follows a run with its status', () => {
    render(<ConversationUiTargets targets={[
      { surface: 'playbook.editor', params: { playbookId: 'p-1', playbookName: 'CV screening' } },
      { surface: 'playbook.execution.details', params: { playbookId: 'p-1', executionId: 'e-1', playbookName: 'CV screening' } },
      { surface: 'playbook.validation', params: { playbookId: 'p-1' } },
    ]} />);
    expect(screen.getByRole('button', { name: /navigation.canvasNamed/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /navigation.executionNamed/ })).toBeInTheDocument();
    // Without a name the button keeps its general label.
    expect(screen.getByRole('button', { name: /^navigation\.validationnavigation/ })).toBeInTheDocument();
    expect(screen.getByText('status of e-1')).toBeInTheDocument();
  });

  it('shows the suggested sources as a card', () => {
    render(<ConversationUiTargets targets={[{ surface: 'semanticModel.sources', params: { modelId: 'model-1', modelName: 'Billing & Contracts' } }]} />);
    expect(screen.getByText('suggestions for Billing & Contracts')).toBeInTheDocument();
  });
});
