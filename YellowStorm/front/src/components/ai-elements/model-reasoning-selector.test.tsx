import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Model } from '@/modules/models/types';
import { ModelReasoningSelector } from './model-reasoning-selector';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const model = {
  id: 'model-1',
  name: 'GPT Test',
  chef: 'OpenAI',
  chefSlug: 'openai',
  litellmModel: 'gpt-test',
  providers: ['openai'],
  type: 'chat',
  types: ['chat'],
  isActive: true,
  isDefault: true,
  isConversationV2Default: false,
  omitTemperature: false,
  inputModalities: ['text'],
  maxInputTokens: null,
  maxOutputTokens: null,
  supportsReasoning: true,
  reasoning: {
    defaultEffort: 'medium',
    efforts: [
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
    ],
  },
} satisfies Model;

function Harness({ onEffortChange, activeModel = model }: { onEffortChange: (effort: string | null) => void; activeModel?: Model }) {
  const [effort, setEffort] = useState<string | null>(null);
  return <ModelReasoningSelector
    models={[activeModel]}
    chefs={[{ slug: 'openai', name: 'OpenAI' }]}
    model={activeModel}
    reasoningEffort={effort}
    onModelChange={vi.fn()}
    onReasoningEffortChange={(next) => {
      setEffort(next);
      onEffortChange(next);
    }}
  />;
}

describe('ModelReasoningSelector', () => {
  it('combines the model and its default effort in one control', async () => {
    const onEffortChange = vi.fn();
    render(<Harness onEffortChange={onEffortChange} />);

    await userEvent.click(screen.getByRole('button', { name: /GPT Test/ }));
    const slider = screen.getByRole('slider', { name: 'input.reasoning.label' });
    expect(screen.getByText('Medium')).toBeInTheDocument();

    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onEffortChange).toHaveBeenCalledWith('high');
    expect(slider).toHaveAttribute('aria-valuetext', 'High');
  });

  it('keeps an explicit default stop when the model has no configured effort default', async () => {
    const onEffortChange = vi.fn();
    const modelWithoutDefault = {
      ...model,
      reasoning: { efforts: model.reasoning.efforts },
    } satisfies Model;
    render(<Harness activeModel={modelWithoutDefault} onEffortChange={onEffortChange} />);

    await userEvent.click(screen.getByRole('button', { name: /GPT Test/ }));
    const slider = screen.getByRole('slider', { name: 'input.reasoning.label' });
    expect(slider).toHaveAttribute('aria-valuetext', 'input.reasoning.default');

    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onEffortChange).toHaveBeenCalledWith('low');
  });

  it('does not expose effort when reasoning is unsupported or hidden', async () => {
    const unsupportedModel = { ...model, supportsReasoning: false } satisfies Model;

    for (const props of [
      { activeModel: unsupportedModel, showReasoningEffort: true },
      { activeModel: model, showReasoningEffort: false },
    ]) {
      const { unmount } = render(<ModelReasoningSelector
        models={[props.activeModel]}
        chefs={[{ slug: 'openai', name: 'OpenAI' }]}
        model={props.activeModel}
        showReasoningEffort={props.showReasoningEffort}
        onModelChange={vi.fn()}
        onReasoningEffortChange={vi.fn()}
      />);

      const trigger = screen.getByRole('button', { name: /GPT Test/ });
      expect(trigger).not.toHaveTextContent('input.reasoning.default');
      await userEvent.click(trigger);
      expect(screen.queryByRole('slider')).not.toBeInTheDocument();
      unmount();
    }
  });
});
