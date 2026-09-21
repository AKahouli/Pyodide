import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PromptInputProvider, usePromptInputController } from './prompt-input';
import { ContentAwareSubmit } from './content-aware-submit';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

function Composer({ disabled = false, files = false }: { disabled?: boolean; files?: boolean }) {
  const { textInput } = usePromptInputController();
  return <form onSubmit={(event) => event.preventDefault()}>
    <textarea aria-label='Draft' value={textInput.value} onChange={(event) => textInput.setInput(event.target.value)} />
    <ContentAwareSubmit aria-label='Send' hasCompletedFiles={files} disabled={disabled} status='ready' />
  </form>;
}

describe('composer readiness', () => {
  it('keeps whitespace unsendable and enables the send button once a draft exists', async () => {
    render(<PromptInputProvider><Composer /></PromptInputProvider>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'My existing draft');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('allows completed file-only messages while preserving the disabled override', () => {
    const { rerender } = render(<PromptInputProvider><Composer files /></PromptInputProvider>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    rerender(<PromptInputProvider><Composer files disabled /></PromptInputProvider>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
