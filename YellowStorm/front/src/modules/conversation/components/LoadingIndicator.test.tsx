import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingIndicator, StreamingCursor } from './LoadingIndicator';

describe('LoadingIndicator', () => {
  it('renders loader container', () => {
    const { container } = render(<LoadingIndicator />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders streaming cursor', () => {
    const { container } = render(<StreamingCursor />);
    expect(container.querySelector('span')).toBeTruthy();
  });
});
