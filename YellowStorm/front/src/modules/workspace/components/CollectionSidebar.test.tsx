import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollectionSidebar, buildTrie } from './CollectionSidebar';

describe('buildTrie', () => {
  it('nests pages that share a path prefix under the same category', () => {
    const roots = buildTrie([
      { url: 'https://ex.com/a/b', title: '' },
      { url: 'https://ex.com/a/c', title: '' },
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].segment).toBe('ex.com');
    const a = roots[0].children.find((n) => n.segment === 'a')!;
    expect(a).toBeDefined();
    expect(a.url).toBeUndefined(); // 'a' was never visited itself → a category, not a page
    expect(a.children.map((n) => n.segment).sort()).toEqual(['b', 'c']);
    expect(a.children.every((n) => !!n.url)).toBe(true);
  });

  it('marks a node as both a page and a category when the parent path was also visited', () => {
    const roots = buildTrie([
      { url: 'https://ex.com/a', title: '' },
      { url: 'https://ex.com/a/b', title: '' },
    ]);
    const a = roots[0].children.find((n) => n.segment === 'a')!;
    expect(a.url).toBe('https://ex.com/a'); // selectable page
    expect(a.children.map((n) => n.segment)).toEqual(['b']); // and a category
  });
});

it('renders the path hierarchy: host + shared segment as categories, leaves selectable', () => {
  render(
    <CollectionSidebar
      pages={[
        { url: 'https://ex.com/a/b', title: '' },
        { url: 'https://ex.com/a/c', title: '' },
        { url: 'https://ex.com/x', title: '' },
      ]}
      selected={new Set()}
      indexedUrls={new Set()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  expect(screen.getByText('ex.com')).toBeInTheDocument(); // host category header
  expect(screen.getByText('a')).toBeInTheDocument(); // shared-segment category header
  expect(screen.getByLabelText('b')).toBeInTheDocument(); // leaf page (title = last segment)
  expect(screen.getByLabelText('c')).toBeInTheDocument();
  expect(screen.getByLabelText('x')).toBeInTheDocument();
});

it('toggles and deletes a leaf by its page name', () => {
  const onToggle = vi.fn();
  const onDelete = vi.fn();
  render(
    <CollectionSidebar
      pages={[
        { url: 'https://ex.com/a/b', title: '' },
        { url: 'https://ex.com/a/c', title: '' },
      ]}
      selected={new Set()}
      indexedUrls={new Set()}
      onToggle={onToggle}
      onDelete={onDelete}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText('b'));
  expect(onToggle).toHaveBeenCalledWith('https://ex.com/a/b');
  fireEvent.click(screen.getByLabelText('delete https://ex.com/a/c'));
  expect(onDelete).toHaveBeenCalledWith('https://ex.com/a/c');
});

it('collapses and expands a category, hiding/showing its children', () => {
  render(
    <CollectionSidebar
      pages={[
        { url: 'https://ex.com/a/b', title: '' },
        { url: 'https://ex.com/a/c', title: '' },
      ]}
      selected={new Set()}
      indexedUrls={new Set()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('b')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('collapse a'));
  expect(screen.queryByLabelText('b')).toBeNull();
  fireEvent.click(screen.getByLabelText('expand a'));
  expect(screen.getByLabelText('b')).toBeInTheDocument();
});

it('disables a leaf already indexed in the workspace', () => {
  render(
    <CollectionSidebar
      pages={[{ url: 'https://ex.com/a/b', title: '' }]}
      selected={new Set()}
      indexedUrls={new Set(['https://ex.com/a/b'])}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('b')).toBeDisabled();
});
