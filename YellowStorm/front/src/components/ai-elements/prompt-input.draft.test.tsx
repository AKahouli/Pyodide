import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { PromptInputProvider, usePromptInputController } from './prompt-input';

function DraftEditor() {
  const { textInput } = usePromptInputController();
  return (
    <>
      <textarea aria-label='draft' value={textInput.value} onChange={(event) => textInput.setInput(event.target.value)} />
      <button onClick={textInput.clear}>clear</button>
    </>
  );
}

describe('PromptInputProvider drafts', () => {
  beforeEach(() => sessionStorage.clear());

  it('restores a remounted draft and clears it explicitly', async () => {
    const user = userEvent.setup();
    const first = render(<PromptInputProvider draftKey='user-1:conversation-1'><DraftEditor /></PromptInputProvider>);
    await user.type(screen.getByLabelText('draft'), 'long message');
    first.unmount();

    render(<PromptInputProvider draftKey='user-1:conversation-1'><DraftEditor /></PromptInputProvider>);
    expect(screen.getByLabelText('draft')).toHaveValue('long message');
    await user.click(screen.getByRole('button', { name: 'clear' }));
    expect(sessionStorage.getItem('yellostorm_draft:user-1:conversation-1')).toBeNull();
  });
});
