import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollectionSidebar, pageName } from './CollectionSidebar';

const pages = [
  { url: 'https://ex.com/a', title: 'A' },
  { url: 'https://ex.com/b', title: 'B' },
];

describe('pageName', () => {
  it('is the last path segment, or the host for a site root', () => {
    expect(pageName('https://ex.com/docs/intro')).toBe('intro');
    expect(pageName('https://ex.com/')).toBe('ex.com');
    expect(pageName('https://ex.com/a%20b')).toBe('a b');
  });
});

it('shows the page name as title (row is labelled by the last segment)', () => {
  const onToggle = vi.fn();
  const onDelete = vi.fn();
  render(
    <CollectionSidebar
      pages={pages}
      selected={new Set(['https://ex.com/a'])}
      indexedUrls={new Set()}
      onToggle={onToggle}
      onDelete={onDelete}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  // Title is the last path segment; the full URL is shown too (as a subtitle).
  fireEvent.click(screen.getByLabelText('b'));
  expect(onToggle).toHaveBeenCalledWith('https://ex.com/b');
  fireEvent.click(screen.getByLabelText('delete https://ex.com/a'));
  expect(onDelete).toHaveBeenCalledWith('https://ex.com/a');
});

it('groups pages sharing the same origin under one category header', () => {
  render(
    <CollectionSidebar
      pages={[
        { url: 'https://ex.com/a', title: 'A' },
        { url: 'https://ex.com/b', title: 'B' },
        { url: 'https://other.com/x', title: 'X' },
      ]}
      selected={new Set()}
      indexedUrls={new Set()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  // One header per origin, named by host.
  expect(screen.getByText('ex.com')).toBeInTheDocument();
  expect(screen.getByText('other.com')).toBeInTheDocument();
});

it('disables rows already indexed in the workspace', () => {
  render(
    <CollectionSidebar
      pages={pages}
      selected={new Set()}
      indexedUrls={new Set(['https://ex.com/a'])}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('a')).toBeDisabled();
});
