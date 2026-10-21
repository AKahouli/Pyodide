import { createContext, Suspense, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from './OpenUiRenderer';

const report = vi.hoisted(() => ({ imported: vi.fn() }));
vi.mock('@openuidev/react-lang', async original => ({ ...await original<typeof import('@openuidev/react-lang')>(), Renderer: ({ response }: { response: string }) => <p>{response}</p> }));
vi.mock('@openuidev/react-ui', async original => ({ ...await original<typeof import('@openuidev/react-ui')>(),
  CardSourceProvider: ({ children }: { children: ReactNode }) => children,
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./library', () => ({ openUiLibrary: {} }));
vi.mock('@/components/ai-elements/ai-message-content', () => ({ CitationsInline: () => null }));
vi.mock('./citations', () => ({
  OpenUiCitationContext: createContext({}),
  splitCitations: () => ({ byReference: new Map(), trailing: [] }),
  toStockSources: () => [],
}));
vi.mock('./document-images', () => ({ createScopedImageCache: () => ({ dispose: vi.fn() }) }));
vi.mock('./ReportBlock', () => {
  report.imported();
  return { ReportBlock: ({ program }: { program: string }) => <p data-testid='loaded-report'>{program}</p> };
});
describe('OpenUI report code loading', () => {
  it('does not import report/slide adapters for ordinary cards', () => {
    render(<OpenUiRenderer content='root = Card([])' isStreaming={false} onAction={vi.fn()} />);
    expect(screen.getByText('root = Card([])')).toBeInTheDocument();
    expect(report.imported).not.toHaveBeenCalled();
  });
  it('loads the adapter when an actual report is present', async () => {
    render(<Suspense fallback='Loading report'><OpenUiRenderer content='root = Report([])' isStreaming={false} onAction={vi.fn()} /></Suspense>);
    expect(await screen.findByTestId('loaded-report')).toHaveTextContent('root = Report([])');
    expect(report.imported).toHaveBeenCalledTimes(1);
  });
});
