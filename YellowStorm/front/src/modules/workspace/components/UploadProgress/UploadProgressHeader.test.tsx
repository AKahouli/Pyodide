import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UploadProgressHeader } from './UploadProgressHeader';

describe('UploadProgressHeader', () => {
  it('toggles and clears when actions are clicked', async () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();

    render(
      <UploadProgressHeader
        hasActiveUploads
        uploadingCount={1}
        pendingCount={1}
        failedCount={0}
        isExpanded
        canClear
        onToggle={onToggle}
        onClear={onClear}
      />,
    );

    await userEvent.click(screen.getByText('upload.header.uploading'));
    expect(onToggle).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'upload.header.clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
