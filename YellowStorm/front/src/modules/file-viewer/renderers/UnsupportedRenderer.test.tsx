import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnsupportedRenderer } from './UnsupportedRenderer';

describe('UnsupportedRenderer', () => {
  it('renders fallback message and filename', () => {
    render(
      <UnsupportedRenderer
        tab={{
          id: 't1',
          fileName: 'archive.bin',
          mimeType: 'application/octet-stream',
          url: 'https://example.test/archive.bin',
        }}
        isActive
      />,
    );

    expect(screen.getByText('unsupported.message')).toBeInTheDocument();
    expect(screen.getByText('archive.bin')).toBeInTheDocument();
  });
});
