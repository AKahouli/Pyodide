import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputContextMenu } from './input-context-menu';
import { PromptInputProvider } from './prompt-input';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => children,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => children,
  ContextMenuSeparator: () => null,
  ContextMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => <button onClick={onSelect}>{children}</button>,
}));

function setup(maxFiles = 5) {
  const onFilesAdded = vi.fn();
  const onError = vi.fn();
  const insert = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: insert });
  render(<PromptInputProvider maxFiles={maxFiles} onFilesAdded={onFilesAdded} onError={onError}>
    <InputContextMenu onMentionAgent={() => {}} onCreateAgent={() => {}}><textarea /></InputContextMenu>
  </PromptInputProvider>);
  return { onFilesAdded, onError, insert };
}

const image = { types: ['image/png'], getType: vi.fn(async () => new Blob(['pixels'], { type: 'image/png' })) };
afterEach(() => vi.unstubAllGlobals());

describe('composer context menu paste', () => {
  it('uploads an image-only clipboard through provider attachments', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: vi.fn(async () => [image]) } });
    const { onFilesAdded, insert } = setup();
    fireEvent.click(screen.getByText('context.paste'));
    await waitFor(() => expect(onFilesAdded).toHaveBeenCalledOnce());
    const file = onFilesAdded.mock.calls[0][0][0] as File;
    expect(file.name).toBe('clipboard-image.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(6);
    expect(insert).not.toHaveBeenCalled();
  });

  it('keeps Office clipboard text instead of uploading its bitmap', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: vi.fn(async () => [image, { types: ['text/plain'], getType: async () => ({ text: async () => 'A\tB' }) }]) } });
    const { onFilesAdded, insert } = setup();
    fireEvent.click(screen.getByText('context.paste'));
    await waitFor(() => expect(insert).toHaveBeenCalledWith('insertText', false, 'A\tB'));
    expect(onFilesAdded).not.toHaveBeenCalled();
  });

  it('respects disabled attachments', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: vi.fn(async () => [image]) } });
    const { onFilesAdded, onError } = setup(0);
    fireEvent.click(screen.getByText('context.paste'));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onFilesAdded).not.toHaveBeenCalled();
  });

  it('retains text-only browser fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn(async () => 'hello') } });
    const { insert } = setup();
    fireEvent.click(screen.getByText('context.paste'));
    await waitFor(() => expect(insert).toHaveBeenCalledWith('insertText', false, 'hello'));
  });
});
