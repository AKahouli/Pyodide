import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { SettingsFormSection } from './SettingsFormSection';
import type { SettingsFormValues } from './schema';

function TestForm({ hasChanges, onCancel, onSubmit }: { hasChanges: boolean; onCancel: () => void; onSubmit: (data: unknown) => void }) {
  const form = useForm<SettingsFormValues>({
    defaultValues: {
      instruction: '',
      chunks: 5,
      hybridSearch: false,
      ragType: 'standard',
      maxToken: 32000,
      topK: 10,
    },
  });

  return <SettingsFormSection form={form} currentSettings={null} isSaving={false} hasChanges={hasChanges} onCancel={onCancel} onSubmit={onSubmit} />;
}

describe('SettingsFormSection', () => {
  it('disables submit when there are no changes and calls cancel handler', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();

    render(<TestForm hasChanges={false} onCancel={onCancel} onSubmit={onSubmit} />);

    expect(screen.getByRole('button', { name: 'settings.actions.create' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'actionCancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
