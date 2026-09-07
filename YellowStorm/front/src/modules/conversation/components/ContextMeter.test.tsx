import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMeter } from './ContextMeter';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}:${values?.percentage ?? ''}`,
  }),
}));

describe('ContextMeter', () => {
  it('renders authoritative context usage', () => {
    render(<ContextMeter usedTokens={250} contextWindow={1000} model='model-a' />);

    expect(screen.getByLabelText('input.contextMeter.label:25')).toBeInTheDocument();
    expect(screen.getByText('input.contextMeter.compact:25')).toBeInTheDocument();
  });

  it('stays hidden without a valid capacity', () => {
    const { container } = render(<ContextMeter usedTokens={250} contextWindow={0} model='model-a' />);
    expect(container).toBeEmptyDOMElement();
  });
});
