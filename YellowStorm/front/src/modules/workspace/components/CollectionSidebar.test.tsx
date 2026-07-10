import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollectionSidebar } from './CollectionSidebar';

const pages = [
  { url: 'https://ex.com/a', title: 'A' },
  { url: 'https://ex.com/b', title: 'B' },
];

it('toggles selection and deletes rows', () => {
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
  fireEvent.click(screen.getByLabelText('B'));
  expect(onToggle).toHaveBeenCalledWith('https://ex.com/b');
  fireEvent.click(screen.getByLabelText('delete https://ex.com/a'));
  expect(onDelete).toHaveBeenCalledWith('https://ex.com/a');
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
  expect(screen.getByLabelText('A')).toBeDisabled();
});
