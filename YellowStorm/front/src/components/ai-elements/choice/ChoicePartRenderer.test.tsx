import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { ChoicePartRenderer } from './ChoicePartRenderer';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

it('visibly selects a list option and enables explicit submission', async () => {
  const user = userEvent.setup();

  render(
    <ChoicePartRenderer
      componentId='choice-1'
      schemaVersion={1}
      questionId='financial_analysis_type'
      prompt='Choose an analysis'
      presentation='list'
      selectionMode='single'
      submitBehavior='explicit'
      status='ready'
      dismissible={false}
      options={[
        { id: 'profitability', label: 'Profitability', submitText: 'Profitability', description: 'Review margins and return.' },
        { id: 'liquidity', label: 'Liquidity', submitText: 'Liquidity', description: 'Review short-term obligations.' },
      ]}
      onAction={vi.fn()}
    />,
  );

  const option = screen.getByRole('radio', { name: /Profitability/ });
  const submit = screen.getByRole('button', { name: 'choice.submit' });
  expect(submit).toBeDisabled();

  await user.click(option);

  expect(option).toHaveAttribute('aria-checked', 'true');
  expect(option).toHaveAttribute('data-selected', 'true');
  expect(option).toHaveClass('border-primary', 'bg-primary/10');
  expect(submit).toBeEnabled();
});

it('renders Other as the final single-select card and submits its free text', async () => {
  const user = userEvent.setup();
  const onAction = vi.fn().mockResolvedValue(undefined);

  render(
    <ChoicePartRenderer
      componentId='choice-1'
      schemaVersion={1}
      questionId='financial_analysis_type'
      prompt='Choose an analysis'
      presentation='list'
      selectionMode='single'
      submitBehavior='explicit'
      status='ready'
      dismissible={false}
      options={[
        { id: 'profitability', label: 'Profitability', submitText: 'Analyze profitability' },
        { id: 'liquidity', label: 'Liquidity', submitText: 'Analyze liquidity' },
      ]}
      otherOption={{ enabled: true, label: 'Other analysis', placeholder: 'Describe your need', maxLength: 500 }}
      onAction={onAction}
    />,
  );

  const options = screen.getAllByRole('radio');
  const normalOption = screen.getByRole('radio', { name: 'Profitability' });
  const otherOption = screen.getByRole('radio', { name: 'Other analysis' });
  const submit = screen.getByRole('button', { name: 'choice.submit' });
  expect(options.at(-1)).toBe(otherOption);
  expect(screen.queryByRole('textbox', { name: 'Other analysis' })).not.toBeInTheDocument();

  await user.click(otherOption);
  expect(otherOption).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('textbox', { name: 'Other analysis' })).toBeInTheDocument();
  expect(submit).toBeDisabled();

  await user.type(screen.getByRole('textbox', { name: 'Other analysis' }), 'Focus on cash conversion');
  await user.click(normalOption);
  expect(otherOption).toHaveAttribute('aria-checked', 'false');
  expect(screen.queryByRole('textbox', { name: 'Other analysis' })).not.toBeInTheDocument();
  expect(normalOption).toHaveAttribute('aria-checked', 'true');

  await user.click(otherOption);
  expect(normalOption).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('textbox', { name: 'Other analysis' })).toHaveValue('');
  await user.type(screen.getByRole('textbox', { name: 'Other analysis' }), 'Compare operating cash flow');
  await user.click(submit);

  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
    submitText: 'Compare operating cash flow',
    interaction: expect.objectContaining({
      selectedOptions: [],
      customAnswer: 'Compare operating cash flow',
    }),
  }));
});

it('allows multiple selections to coexist with a completed Other response', async () => {
  const user = userEvent.setup();
  const onAction = vi.fn().mockResolvedValue(undefined);

  render(
    <ChoicePartRenderer
      componentId='choice-1'
      schemaVersion={1}
      questionId='financial_analysis_type'
      prompt='Choose analyses'
      presentation='list'
      selectionMode='multiple'
      submitBehavior='explicit'
      status='ready'
      dismissible={false}
      options={[
        { id: 'profitability', label: 'Profitability', submitText: 'Analyze profitability' },
        { id: 'liquidity', label: 'Liquidity', submitText: 'Analyze liquidity' },
      ]}
      otherOption={{ enabled: true, label: 'Other analysis', maxLength: 500 }}
      onAction={onAction}
    />,
  );

  await user.click(screen.getByRole('checkbox', { name: 'Profitability' }));
  await user.click(screen.getByRole('checkbox', { name: 'Other analysis' }));
  const submit = screen.getByRole('button', { name: 'choice.submit' });
  expect(submit).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: 'Other analysis' }), 'Include working capital');
  expect(submit).toBeEnabled();
  await user.click(submit);

  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
    interaction: expect.objectContaining({
      selectedOptions: [{ optionId: 'profitability', label: 'Profitability' }],
      customAnswer: 'Include working capital',
    }),
  }));
});

it('does not repeat selected values after the user response is displayed', async () => {
  render(
    <ChoicePartRenderer
      componentId='choice-1'
      schemaVersion={1}
      questionId='financial_analysis_type'
      prompt='Choose an analysis'
      presentation='list'
      selectionMode='single'
      submitBehavior='explicit'
      status='ready'
      dismissible={false}
      options={[
        { id: 'profitability', label: 'Profitability', submitText: 'Analyze profitability' },
        { id: 'liquidity', label: 'Liquidity', submitText: 'Analyze liquidity' },
      ]}
      submittedInteraction={{
        type: 'choice', componentId: 'choice-1', questionId: 'financial_analysis_type',
        selectionMode: 'single', selectedOptions: [{ optionId: 'profitability', label: 'Profitability' }],
        displayText: 'Profitability',
      }}
    />,
  );

  await waitFor(() => expect(screen.getByText('choice.submitted')).toBeInTheDocument());
  expect(screen.queryByText('Profitability')).not.toBeInTheDocument();
});

it('edit-on-card: approve submits the edited fields as JSON edits', async () => {
  const user = userEvent.setup();
  const onAction = vi.fn().mockResolvedValue(undefined);
  render(
    <ChoicePartRenderer
      componentId='c1'
      schemaVersion={1}
      questionId='confirm::adk-x'
      prompt='Approuver ?'
      presentation='quick_replies'
      selectionMode='single'
      submitBehavior='immediate'
      status='ready'
      dismissible={false}
      editable
      fields={[
        { key: 'subject', label: 'Objet', value: 'Status' },
        { key: 'body', label: 'Message', value: 'Hi', multiline: true },
      ]}
      options={[
        { id: 'approve', label: 'Approuver', submitText: 'approve' },
        { id: 'decline', label: 'Refuser', submitText: 'decline' },
      ]}
      onAction={onAction}
    />,
  );
  // Preview by default — reveal the inputs first, then edit.
  expect(screen.queryByDisplayValue('Status')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Modifier/ }));
  const subject = screen.getByDisplayValue('Status');
  await user.clear(subject);
  await user.type(subject, 'URGENT');
  await user.click(screen.getByRole('radio', { name: 'Approuver' }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
    submitText: JSON.stringify({ verdict: 'approve', edits: { subject: 'URGENT', body: 'Hi' } }),
  }));
});

it('edit-on-card: shows a read-only preview until Modifier is clicked, and Cancel reverts', async () => {
  const user = userEvent.setup();
  const onAction = vi.fn().mockResolvedValue(undefined);
  render(
    <ChoicePartRenderer
      componentId='c3'
      schemaVersion={1}
      questionId='confirm::adk-z'
      prompt='Approuver ?'
      presentation='quick_replies'
      selectionMode='single'
      submitBehavior='immediate'
      status='ready'
      dismissible={false}
      editable
      fields={[{ key: 'subject', label: 'Objet', value: 'Status' }]}
      options={[
        { id: 'approve', label: 'Approuver', submitText: 'approve' },
        { id: 'decline', label: 'Refuser', submitText: 'decline' },
      ]}
      onAction={onAction}
    />,
  );
  // Preview: value shown, no input.
  expect(screen.getByText('Status')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Status')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Modifier/ }));
  const subject = screen.getByDisplayValue('Status');
  await user.clear(subject);
  await user.type(subject, 'CHANGED');
  // Cancel reverts and returns to preview.
  await user.click(screen.getByRole('button', { name: /Annuler/ }));
  expect(screen.queryByDisplayValue('CHANGED')).not.toBeInTheDocument();
  expect(screen.getByText('Status')).toBeInTheDocument();
});

it('edit-on-card: decline stays a plain verdict', async () => {
  const user = userEvent.setup();
  const onAction = vi.fn().mockResolvedValue(undefined);
  render(
    <ChoicePartRenderer
      componentId='c2'
      schemaVersion={1}
      questionId='confirm::adk-y'
      prompt='Approuver ?'
      presentation='quick_replies'
      selectionMode='single'
      submitBehavior='immediate'
      status='ready'
      dismissible={false}
      editable
      fields={[{ key: 'subject', label: 'Objet', value: 'Status' }]}
      options={[
        { id: 'approve', label: 'Approuver', submitText: 'approve' },
        { id: 'decline', label: 'Refuser', submitText: 'decline' },
      ]}
      onAction={onAction}
    />,
  );
  await user.click(screen.getByRole('radio', { name: 'Refuser' }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ submitText: 'decline' }));
});

it('edit-on-card: renders a markdown body formatted in the preview', () => {
  render(
    <ChoicePartRenderer
      componentId='c4'
      schemaVersion={1}
      questionId='confirm::adk-md'
      prompt='Approuver ?'
      presentation='quick_replies'
      selectionMode='single'
      submitBehavior='immediate'
      status='ready'
      dismissible={false}
      editable
      fields={[{ key: 'body', label: 'Message', value: 'Bonjour **Adem**', multiline: true, markdown: true }]}
      options={[
        { id: 'approve', label: 'Approuver', submitText: 'approve' },
        { id: 'decline', label: 'Refuser', submitText: 'decline' },
      ]}
      onAction={vi.fn()}
    />,
  );
  // **Adem** renders as <strong>, not literal asterisks.
  expect(screen.getByText('Adem').tagName).toBe('STRONG');
  expect(screen.queryByText(/\*\*Adem\*\*/)).not.toBeInTheDocument();
});
