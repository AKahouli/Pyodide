import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ManyRecordsSwitch } from './DocumentFieldRules';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('ManyRecordsSwitch', () => {
  it('turns several records per document on and off, keeping the reading limits', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ManyRecordsSwitch value={{ maxBlocks: 100 }} onChange={onChange} />);
    expect(screen.getByText('mapping.manyRecords.off')).toBeInTheDocument();
    expect(screen.getByText('mapping.manyRecords.tip')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('mapping.manyRecords.label'));
    expect(onChange).toHaveBeenLastCalledWith({ maxBlocks: 100, manyRecords: true });

    rerender(<ManyRecordsSwitch value={{ maxBlocks: 100, manyRecords: true }} onChange={onChange} />);
    expect(screen.getByText('mapping.manyRecords.on')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('mapping.manyRecords.label'));
    expect(onChange).toHaveBeenLastCalledWith({ maxBlocks: 100 });
  });
});
