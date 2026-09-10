import { fireEvent, render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PromptInput, PromptInputTextarea, usePromptInputAttachments } from './prompt-input';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

function AttachmentCount() {
  const attachments = usePromptInputAttachments();
  return <span data-testid='count'>{attachments.files.length}</span>;
}

const imageFile = () => new File(['x'], 'cell.png', { type: 'image/png' });

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

function pasteClipboard(textarea: Element, items: object[], text: string) {
  fireEvent.paste(textarea, {
    clipboardData: {
      items,
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  });
}

describe('PromptInputTextarea paste', () => {
  it('pastes Excel cells as text instead of attaching the clipboard bitmap', () => {
    const { container, getByTestId } = render(
      <PromptInput onSubmit={() => {}}>
        <PromptInputTextarea />
        <AttachmentCount />
      </PromptInput>,
    );
    const textarea = container.querySelector('textarea')!;

    pasteClipboard(
      textarea,
      [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile() }],
      'cell value',
    );

    expect(getByTestId('count').textContent).toBe('0');
  });

  it('still attaches image-only pastes like screenshots', () => {
    const { container, getByTestId } = render(
      <PromptInput onSubmit={() => {}}>
        <PromptInputTextarea />
        <AttachmentCount />
      </PromptInput>,
    );
    const textarea = container.querySelector('textarea')!;

    pasteClipboard(
      textarea,
      [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile() }],
      '',
    );

    expect(getByTestId('count').textContent).toBe('1');
  });
});
