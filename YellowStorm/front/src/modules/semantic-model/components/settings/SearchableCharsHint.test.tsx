import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_INDEX_DEFAULTS } from '../../searchSettings';
import { SearchableCharsHint, searchableChars } from './SearchableCharsHint';

const api = vi.hoisted(() => ({ getAdminIndex: vi.fn() }));
vi.mock('../../searchSettings', async (importOriginal) => ({ ...(await importOriginal<object>()), searchSettingsApi: api }));
const translation = vi.hoisted(() => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => translation }));

describe('searchableChars', () => {
  it('counts the passages of a field minus the overlap each one repeats', () => {
    // 20 passages of 1000 characters, 150 shared with the previous one.
    expect(searchableChars({ passageTargetChars: 1000, passageOverlapChars: 150, maxPassagesPerField: 20 })).toBe(17150);
  });
});

describe('SearchableCharsHint', () => {
  beforeEach(() => {
    api.getAdminIndex.mockReset();
    api.getAdminIndex.mockResolvedValue({ settings: SEARCH_INDEX_DEFAULTS, configured: {}, defaults: SEARCH_INDEX_DEFAULTS });
  });

  it('tells how much of a field a search finds, from the index settings in force', async () => {
    api.getAdminIndex.mockResolvedValue({ settings: { ...SEARCH_INDEX_DEFAULTS, maxPassagesPerField: 40 }, configured: {}, defaults: SEARCH_INDEX_DEFAULTS });
    render(<SearchableCharsHint reading={{}} />);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('"chars":"34,150"');
    expect(note).toHaveTextContent('"passages":40');
  });

  it('warns when a reading limit stores more than a search can find, and only then', async () => {
    const { rerender } = render(<SearchableCharsHint reading={{ maxAttachmentChars: 40000 }} />);
    await screen.findByRole('note');
    // The built-in 100,000 characters of the body also exceed the 17,150 found: the warning names the larger limit.
    expect(screen.getByText(/searchableWarn/)).toHaveTextContent('"limit":"100,000"');
    rerender(<SearchableCharsHint reading={{ maxAttachmentChars: 10000, maxBodyChars: 10000 }} />);
    expect(screen.queryByText(/searchableWarn/)).not.toBeInTheDocument();
  });

  it('shows no hint when the index settings cannot be loaded', async () => {
    api.getAdminIndex.mockRejectedValue(new Error('forbidden'));
    render(<SearchableCharsHint reading={{}} />);
    await waitFor(() => expect(api.getAdminIndex).toHaveBeenCalled());
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
