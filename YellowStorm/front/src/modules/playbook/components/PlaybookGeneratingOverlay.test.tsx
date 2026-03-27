import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlaybookGeneratingOverlay } from './PlaybookGeneratingOverlay';

describe('PlaybookGeneratingOverlay', () => {
  it('renders translated defaults when no props are provided', () => {
    render(<PlaybookGeneratingOverlay />);
    expect(screen.getByText('canvas.generating')).toBeInTheDocument();
    expect(screen.getByText('canvas.generatingHint')).toBeInTheDocument();
  });

  it('renders custom title and subtitle overrides', () => {
    render(<PlaybookGeneratingOverlay title='Building flow' subtitle='Please wait' />);
    expect(screen.getByText('Building flow')).toBeInTheDocument();
    expect(screen.getByText('Please wait')).toBeInTheDocument();
  });
});
