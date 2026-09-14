import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReasoningEffortSelector } from '@/components/ai-elements/reasoning-effort-selector';
import { ReasoningEffortSelect, ReliabilityCheckToggle, useReasoningEffortState } from './ReasoningEffortSelect';
import { useConversationUiStore } from '../uiStore';

const setSelectedReasoningEffortMock = vi.hoisted(() => vi.fn());
const storeStateMock = vi.hoisted(() => ({
  selectedModelId: 'model-1' as string | null,
  selectedReasoningEffort: null as string | null,
}));

vi.mock('../store', () => ({
  useSelectedModelId: () => storeStateMock.selectedModelId,
  useSelectedReasoningEffort: () => storeStateMock.selectedReasoningEffort,
  useSetSelectedReasoningEffort: () => setSelectedReasoningEffortMock,
}));

const modelsStateMock = vi.hoisted(() => ({
  models: [] as Array<Record<string, unknown>>,
  defaultModel: null as Record<string, unknown> | null,
}));

vi.mock('@/modules/models', () => ({
  useModels: () => modelsStateMock.models,
  useDefaultModel: () => modelsStateMock.defaultModel,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const reasoningModel = {
  id: 'model-1',
  supportsReasoning: true,
  reasoning: {
    defaultEffort: 'medium',
    efforts: [
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
    ],
  },
};

function HookProbe({ onState }: { onState: (state: ReturnType<typeof useReasoningEffortState>) => void }) {
  onState(useReasoningEffortState());
  return null;
}

describe('ReasoningEffortSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeStateMock.selectedModelId = 'model-1';
    storeStateMock.selectedReasoningEffort = null;
    modelsStateMock.models = [reasoningModel];
    modelsStateMock.defaultModel = null;
    useConversationUiStore.setState({ autoReliabilityEnabled: false });
  });

  it('renders nothing when the active model exposes no reasoning efforts', () => {
    modelsStateMock.models = [{ id: 'model-1', supportsReasoning: false, reasoning: { efforts: [] } }];
    const { container } = render(<ReasoningEffortSelect />);
    expect(container).toBeEmptyDOMElement();
  });

  it('preselects the model default effort when nothing was picked', () => {
    render(<ReasoningEffortSelect />);
    expect(screen.getByRole('button', { name: 'input.reasoning.label' })).toHaveTextContent('Medium');
  });

  it('keeps a stored selection that is valid for the active model', () => {
    storeStateMock.selectedReasoningEffort = 'high';
    render(<ReasoningEffortSelect />);
    expect(screen.getByRole('button', { name: 'input.reasoning.label' })).toHaveTextContent('High');
  });

  it('falls back to the model default when the stored selection does not apply', () => {
    storeStateMock.selectedReasoningEffort = 'ultra';
    const stateHolder: { current: ReturnType<typeof useReasoningEffortState> | null } = { current: null };
    render(
      <>
        <ReasoningEffortSelect />
        <HookProbe onState={(resolved) => (stateHolder.current = resolved)} />
      </>,
    );
    expect(stateHolder.current?.effectiveEffort).toBe('medium');
    expect(screen.getByRole('button', { name: 'input.reasoning.label' })).toHaveTextContent('Medium');
  });

  it('resolves the effort from the default model when nothing is explicitly selected', () => {
    storeStateMock.selectedModelId = null;
    modelsStateMock.models = [];
    modelsStateMock.defaultModel = reasoningModel;
    const stateHolder: { current: ReturnType<typeof useReasoningEffortState> | null } = { current: null };
    render(
      <>
        <ReasoningEffortSelect />
        <HookProbe onState={(resolved) => (stateHolder.current = resolved)} />
      </>,
    );
    expect(stateHolder.current?.efforts).toHaveLength(3);
    expect(stateHolder.current?.effectiveEffort).toBe('medium');
  });

  it('emits the picked effort', async () => {
    render(<ReasoningEffortSelect />);
    await userEvent.click(screen.getByRole('button', { name: 'input.reasoning.label' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));
    expect(setSelectedReasoningEffortMock).toHaveBeenCalledWith('high');
  });

  it('renders the reliability badge off by default and enables it on click', async () => {
    render(<ReliabilityCheckToggle />);
    const badge = screen.getByRole('button', { name: 'input.autoReliability' });
    expect(badge).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(badge);

    expect(badge).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports a full-width controlled selector for forms', async () => {
    const onValueChange = vi.fn();
    render(
      <ReasoningEffortSelector
        efforts={reasoningModel.reasoning.efforts}
        value='low'
        onValueChange={onValueChange}
        label='Reasoning effort'
        fullWidth
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reasoning effort' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));
    expect(onValueChange).toHaveBeenCalledWith('high');
  });

  it('renders a disabled controlled selector when a model has no efforts', () => {
    render(
      <ReasoningEffortSelector
        efforts={[]}
        value={undefined}
        onValueChange={vi.fn()}
        label='Reasoning effort unavailable'
        disabled
      />,
    );

    expect(screen.getByRole('button', { name: 'Reasoning effort unavailable' })).toBeDisabled();
  });
});
