import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepIndicator } from './StepIndicator';

describe('StepIndicator', () => {
  it('renders the expected number of step dots', () => {
    const { container } = render(<StepIndicator currentStep={2} totalSteps={4} />);
    expect(container.querySelectorAll('div.rounded-full')).toHaveLength(4);
  });
});
