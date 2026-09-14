import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PromptInputProvider, usePromptInputController } from '@/components/ai-elements/prompt-input';
import { ContentAwareSubmit } from '@/components/ai-elements/content-aware-submit';
import { HomePromptSuggestions } from './HomePromptSuggestions';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({
  t: (key: string, values?: { scope?: string }) => values?.scope ? `${key}: ${values.scope}` : key,
}) }));

function Composer({ scopeName, disabled = false, files = false }: { scopeName?: string; disabled?: boolean; files?: boolean }) {
  const { textInput } = usePromptInputController();
  return <form onSubmit={(event) => event.preventDefault()}>
    <textarea aria-label='Draft' value={textInput.value} onChange={(event) => textInput.setInput(event.target.value)} />
    <HomePromptSuggestions scopeName={scopeName} disabled={disabled} />
    <ContentAwareSubmit aria-label='Send' hasCompletedFiles={files} disabled={disabled} status='ready' />
  </form>;
}

describe('Homepage composer suggestions and readiness', () => {
  it('fills and focuses a governed draft without sending, then hides suggestions', async () => {
    render(<PromptInputProvider><Composer scopeName='Support' /></PromptInputProvider>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'home.prompts.governed.understand.label' }));
    expect(screen.getByRole('textbox')).toHaveValue('home.prompts.governed.understand.draft: Support');
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('preserves an existing draft across scope changes and keeps whitespace unsendable', async () => {
    const { rerender } = render(<PromptInputProvider><Composer /></PromptInputProvider>);
    await userEvent.type(screen.getByRole('textbox'), 'My existing draft');
    rerender(<PromptInputProvider><Composer scopeName='Support' /></PromptInputProvider>);
    expect(screen.getByRole('textbox')).toHaveValue('My existing draft');
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'home.prompts.governed.understand.label' })).toBeInTheDocument();
  });

  it('allows completed file-only messages while preserving upload and usage disabling', () => {
    const { rerender } = render(<PromptInputProvider><Composer files /></PromptInputProvider>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    rerender(<PromptInputProvider><Composer files disabled /></PromptInputProvider>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
