import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageTree } from './PageTree';
import type { PageNode } from '../types';

const nodes: PageNode[] = [
  { url: 'https://ex.com/', path: '/', alreadyIndexed: false, children: [
    { url: 'https://ex.com/a', path: '/a', alreadyIndexed: false, children: [] },
    { url: 'https://ex.com/b', path: '/b', alreadyIndexed: true, children: [] },
  ] },
];

describe('PageTree', () => {
  it('toggles a selectable page and disables already-indexed rows', () => {
    const onToggle = vi.fn();
    render(<PageTree nodes={nodes} selected={new Set(['https://ex.com/'])} onToggle={onToggle} onFocus={() => {}} />);
    // '/a' is selectable
    fireEvent.click(screen.getByLabelText('/a'));
    expect(onToggle).toHaveBeenCalledWith('https://ex.com/a');
    // '/b' is already indexed -> its checkbox is disabled
    expect((screen.getByLabelText('/b') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/déjà indexé/i)).toBeInTheDocument();
  });
});
