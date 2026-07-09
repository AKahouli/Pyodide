import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageTree } from './PageTree';
import type { PageNode } from '../types';

const nodes: PageNode[] = [
  { url: 'https://ex.com/', path: '/', name: 'ex.com', alreadyIndexed: false, children: [
    { url: 'https://ex.com/a', path: '/a', name: 'a', alreadyIndexed: false, children: [] },
    { url: 'https://ex.com/b', path: '/b', name: 'b', alreadyIndexed: true, children: [] },
  ] },
  // Synthetic group (no url) with a real child page.
  { url: '', path: '/page', name: 'page', alreadyIndexed: false, children: [
    { url: 'https://ex.com/page/x', path: '/page/x', name: 'x', alreadyIndexed: false, children: [] },
  ] },
];

describe('PageTree', () => {
  it('shows the page name (not the full path) and toggles selectable pages', () => {
    const onToggle = vi.fn();
    render(<PageTree nodes={nodes} selected={new Set(['https://ex.com/'])} onToggle={onToggle} onFocus={() => {}} />);
    // Label is the page name, not the path.
    fireEvent.click(screen.getByLabelText('a'));
    expect(onToggle).toHaveBeenCalledWith('https://ex.com/a');
    // Already-indexed page's checkbox is disabled + badged.
    expect((screen.getByLabelText('b') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/déjà indexé/i)).toBeInTheDocument();
  });

  it('renders group nodes as non-selectable headers (no checkbox)', () => {
    render(<PageTree nodes={nodes} selected={new Set()} onToggle={() => {}} onFocus={() => {}} />);
    // The 'page' group has no checkbox, but its real child 'x' does.
    expect(screen.queryByLabelText('page')).toBeNull();
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(screen.getByLabelText('x')).toBeInTheDocument();
  });
});
