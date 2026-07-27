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

  it('names a visited-page leaf after the clicked link text when present', () => {
    const roots = buildTrie([{ url: 'https://ex.com/a/b', title: 'B Title', linkText: 'Our Services' }]);
    const a = roots[0].children.find((n) => n.segment === 'a')!;
    const b = a.children.find((n) => n.segment === 'b')!;
    expect(b.label).toBe('Our Services');
  });

  it('falls back to the page title when there is no link text', () => {
    const roots = buildTrie([{ url: 'https://ex.com/a/b', title: 'B Title' }]);
    const b = roots[0].children[0].children[0];
    expect(b.label).toBe('B Title');
  });

  it('leaves label undefined (URL-segment fallback) when neither link text nor title exist', () => {
    const roots = buildTrie([{ url: 'https://ex.com/a/b', title: '' }]);
    const b = roots[0].children[0].children[0];
    expect(b.label).toBeUndefined();
  });

  it('carries indexingStatus onto the leaf node', () => {
    const roots = buildTrie([{ url: 'https://ex.com/a', title: '', indexingStatus: 'ready' }]);
    expect(roots[0].children[0].indexingStatus).toBe('ready');
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

it('shows the clicked link text as the leaf name, keeping the URL segment as its category', () => {
  render(
    <CollectionSidebar
      pages={[{ url: 'https://ex.com/services/pricing', title: 'Pricing', linkText: 'See Pricing' }]}
      selected={new Set()}
      indexedUrls={new Set()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  expect(screen.getByText('services')).toBeInTheDocument(); // category = URL segment
  expect(screen.getByLabelText('See Pricing')).toBeInTheDocument(); // leaf = clicked text
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

it('navigates when a page row is clicked, but not when its checkbox is clicked', () => {
  const onNavigate = vi.fn();
  const onToggle = vi.fn();
  render(
    <CollectionSidebar
      pages={[{ url: 'https://ex.com/services/pricing', title: 'Pricing', linkText: 'See Pricing' }]}
      selected={new Set()}
      indexedUrls={new Set()}
      onToggle={onToggle}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
      onNavigate={onNavigate}
    />,
  );
  // Clicking the row (its name) navigates to that page.
  fireEvent.click(screen.getByText('See Pricing'));
  expect(onNavigate).toHaveBeenCalledWith('https://ex.com/services/pricing');
  // Clicking the checkbox toggles selection WITHOUT navigating.
  onNavigate.mockClear();
  fireEvent.click(screen.getByLabelText('See Pricing'));
  expect(onToggle).toHaveBeenCalledWith('https://ex.com/services/pricing');
  expect(onNavigate).not.toHaveBeenCalled();
});

it('does not navigate when the delete action is clicked', () => {
  const onNavigate = vi.fn();
  const onDelete = vi.fn();
  render(
    <CollectionSidebar
      pages={[{ url: 'https://ex.com/a', title: '', linkText: 'Alpha' }]}
      selected={new Set()}
      indexedUrls={new Set()}
      onToggle={vi.fn()}
      onDelete={onDelete}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
      onNavigate={onNavigate}
    />,
  );
  fireEvent.click(screen.getByLabelText('delete https://ex.com/a'));
  expect(onDelete).toHaveBeenCalledWith('https://ex.com/a');
  expect(onNavigate).not.toHaveBeenCalled();
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

const baseProps = {
  selected: new Set<string>(), indexedUrls: new Set<string>(),
  onToggle: vi.fn(), onDelete: vi.fn(), onSelectAll: vi.fn(), onSelectNone: vi.fn(),
};

it('renders a status dot for a page with an indexing status and none without', () => {
  const { rerender } = render(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A', indexingStatus: 'ready' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} />);
  expect(screen.getByRole('img', { name: 'Indexé' })).toBeInTheDocument();
  rerender(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} />);
  expect(screen.queryByRole('img', { name: 'Indexé' })).not.toBeInTheDocument();
});

it('add row calls onAdd with the url and name', () => {
  const onAdd = vi.fn().mockReturnValue(true);
  render(<CollectionSidebar pages={[]} {...baseProps} onAdd={onAdd} onEdit={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('URL du lien'), { target: { value: 'https://x.com/p' } });
  fireEvent.change(screen.getByLabelText('Nom du lien'), { target: { value: 'My Page' } });
  fireEvent.click(screen.getByLabelText('Ajouter le lien'));
  expect(onAdd).toHaveBeenCalledWith('https://x.com/p', 'My Page');
});

it('shows feedback when onAdd rejects', () => {
  const onAdd = vi.fn().mockReturnValue(false);
  render(<CollectionSidebar pages={[]} {...baseProps} onAdd={onAdd} onEdit={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('URL du lien'), { target: { value: 'https://x.com/p' } });
  fireEvent.click(screen.getByLabelText('Ajouter le lien'));
  expect(screen.getByText(/invalide ou déjà/i)).toBeInTheDocument();
});

it('editing a leaf via the pencil popover calls onEdit', () => {
  const onEdit = vi.fn().mockReturnValue(true);
  render(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A' }]} {...baseProps} onAdd={vi.fn()} onEdit={onEdit} />);
  fireEvent.click(screen.getByLabelText('edit https://ex.com/a'));
  fireEvent.change(screen.getByLabelText('Nom du lien à éditer'), { target: { value: 'B' } });
  fireEvent.change(screen.getByLabelText('URL du lien à éditer'), { target: { value: 'https://ex.com/b' } });
  fireEvent.click(screen.getByText('Enregistrer'));
  expect(onEdit).toHaveBeenCalledWith('https://ex.com/a', { url: 'https://ex.com/b', name: 'B' });
});

it('renders a pencil only on page leaves, not category-only nodes', () => {
  // 'https://ex.com/a/b' makes a category node 'a' (no url) and a leaf 'b' (has url).
  render(<CollectionSidebar pages={[{ url: 'https://ex.com/a/b', title: '', linkText: 'B' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} />);
  expect(screen.getByLabelText('edit https://ex.com/a/b')).toBeInTheDocument(); // leaf editable
  expect(screen.getAllByLabelText(/^edit /)).toHaveLength(1); // exactly one pencil → category 'a' has none
});

it('calls onExplore with the leaf url and shows a spinner while exploring', () => {
  const onExplore = vi.fn();
  const { rerender } = render(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} onExplore={onExplore} exploring={new Set()} />);
  fireEvent.click(screen.getByLabelText('explore https://ex.com/a'));
  expect(onExplore).toHaveBeenCalledWith('https://ex.com/a');
  rerender(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} onExplore={onExplore} exploring={new Set(['https://ex.com/a'])} />);
  expect(screen.getByLabelText('explore https://ex.com/a')).toBeDisabled();
});
