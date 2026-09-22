import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import type { ChoiceComponentData } from '@/modules/conversation/types';
import { ChoiceTabsQuestions } from './ChoiceTabsQuestions';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

function question(componentId: string, questionId: string, prompt: string): { componentId: string; choice: ChoiceComponentData } {
  return {
    componentId,
    choice: {
      schemaVersion: 1,
      questionId,
      prompt,
      presentation: 'list',
      selectionMode: 'single',
      submitBehavior: 'explicit',
      status: 'ready',
      dismissible: false,
      options: [
        { id: 'a', label: `Option A for ${questionId}`, submitText: `Choose A for ${questionId}` },
        { id: 'b', label: `Option B for ${questionId}`, submitText: `Choose B for ${questionId}` },
      ],
    },
  };
}

it('pages through questions and submits all answers at the end', async () => {
  const user = userEvent.setup();
  const onSubmitAll = vi.fn().mockResolvedValue(undefined);

  render(
    <ChoiceTabsQuestions
      questions={[question('c1', 'region', 'Pick a region'), question('c2', 'scope', 'Pick a scope')]}
      onSubmitAll={onSubmitAll}
    />,
  );

  const next = screen.getByRole('button', { name: 'choice.next' });
  expect(next).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: 'Option A for region' }));
  expect(next).toBeEnabled();
  await user.click(next);
  await user.click(screen.getByRole('radio', { name: 'Option B for scope' }));

  const submit = screen.getByRole('button', { name: 'choice.submitAll' });
  expect(submit).toBeEnabled();
  await user.click(submit);

  await waitFor(() => expect(onSubmitAll).toHaveBeenCalledTimes(1));
  const actions = onSubmitAll.mock.calls[0][0];
  expect(actions).toHaveLength(2);
  expect(actions[0]).toMatchObject({
    componentId: 'c1',
    interaction: expect.objectContaining({
      componentId: 'c1',
      questionId: 'region',
      selectedOptions: [{ optionId: 'a', label: 'Option A for region' }],
    }),
  });
  expect(actions[1]).toMatchObject({
    componentId: 'c2',
    interaction: expect.objectContaining({
      componentId: 'c2',
      questionId: 'scope',
      selectedOptions: [{ optionId: 'b', label: 'Option B for scope' }],
    }),
  });
});

it('keeps the submit disabled until every question has an answer', async () => {
  const user = userEvent.setup();
  const onSubmitAll = vi.fn().mockResolvedValue(undefined);

  render(
    <ChoiceTabsQuestions
      questions={[question('c1', 'region', 'Pick a region'), question('c2', 'scope', 'Pick a scope')]}
      onSubmitAll={onSubmitAll}
    />,
  );

  const next = screen.getByRole('button', { name: 'choice.next' });
  await user.click(screen.getByRole('radio', { name: 'Option A for region' }));
  await user.click(next);
  const submit = screen.getByRole('button', { name: 'choice.submitAll' });
  expect(submit).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: 'Option B for scope' }));
  expect(submit).toBeEnabled();

  await user.click(screen.getByRole('button', { name: 'choice.back' }));
  expect(screen.getByRole('radio', { name: 'Option A for region' })).toBeChecked();
});

it('shows a single submitted summary once all interactions are provided', async () => {
  const submittedInteractions = new Map([
    ['c1', { type: 'choice' as const, componentId: 'c1', questionId: 'region', selectionMode: 'single' as const, selectedOptions: [{ optionId: 'a', label: 'Option A for region' }], displayText: 'Option A for region' }],
    ['c2', { type: 'choice' as const, componentId: 'c2', questionId: 'scope', selectionMode: 'single' as const, selectedOptions: [{ optionId: 'b', label: 'Option B for scope' }], displayText: 'Option B for scope' }],
  ]);

  render(
    <ChoiceTabsQuestions
      questions={[question('c1', 'region', 'Pick a region'), question('c2', 'scope', 'Pick a scope')]}
      submittedInteractions={submittedInteractions}
    />,
  );

  await waitFor(() => expect(screen.getByText('choice.submitted')).toBeInTheDocument());
  expect(screen.queryByText('Pick a region')).not.toBeInTheDocument();
});

it('supports the Other free-text option inside a page', async () => {
  const user = userEvent.setup();
  const onSubmitAll = vi.fn().mockResolvedValue(undefined);
  const other = {
    componentId: 'c1',
    choice: {
      schemaVersion: 1,
      questionId: 'region',
      prompt: 'Pick a region',
      presentation: 'list',
      selectionMode: 'single',
      submitBehavior: 'explicit',
      status: 'ready',
      dismissible: false,
      options: [
        { id: 'a', label: 'France', submitText: 'Choose France' },
      ],
      otherOption: { enabled: true, label: 'Custom region', placeholder: 'Type a region', maxLength: 500 },
    } as ChoiceComponentData,
  };

  render(<ChoiceTabsQuestions questions={[other]} onSubmitAll={onSubmitAll} />);

  const submit = screen.getByRole('button', { name: 'choice.submitAll' });
  await user.click(screen.getByRole('radio', { name: 'Custom region' }));
  await user.type(screen.getByRole('textbox', { name: 'Custom region' }), 'Nordics');
  expect(submit).toBeEnabled();
  await user.click(submit);

  await waitFor(() => expect(onSubmitAll).toHaveBeenCalledTimes(1));
  expect(onSubmitAll.mock.calls[0][0][0]).toMatchObject({
    interaction: expect.objectContaining({
      selectedOptions: [],
      customAnswer: 'Nordics',
    }),
  });
});
