import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { captureOpenUiChartPng } from './docx-capture';
import { toPng } from 'html-to-image';

vi.mock('@openuidev/thesys', () => ({ chatLibrary: { components: {
  BarChart: { component: () => <div className='c1-chart-wrapper'><svg aria-label='Bar chart'><text>Osaka</text></svg><div>Visits legend</div></div> },
} }, reportLibrary: { components: {} } }));
vi.mock('@openuidev/react-ui', () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/openui/theme', () => ({ OPENUI_COMPACT_THEME: {} }));
vi.mock('html-to-image', () => ({ toPng: vi.fn(async () => 'data:image/png;base64,Y2hhcnQ=') }));

afterEach(() => vi.restoreAllMocks());

it('captures native D3 SVG and HTML legend together and removes the offscreen host', async () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 320 } as DOMRect);
  vi.mocked(toPng).mockImplementationOnce(async (node) => {
    expect(node.querySelector('svg')).not.toHaveClass('recharts-surface');
    expect(node.textContent).toContain('Visits legend');
    expect(node.isConnected).toBe(true);
    return 'data:image/png;base64,Y2hhcnQ=';
  });
  expect(await captureOpenUiChartPng('BarChart', { labels: ['Osaka'], series: [{ category: 'Visits', values: [0] }] }))
    .toEqual({ dataUrl: 'data:image/png;base64,Y2hhcnQ=', width: 640, height: 320 });
  expect(document.querySelector('[id^="export-chart-"]')).toBeNull();
});

it('cleans up when image serialization fails', async () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 320 } as DOMRect);
  vi.mocked(toPng).mockRejectedValueOnce(new Error('capture unavailable'));
  await expect(captureOpenUiChartPng('BarChart', {})).rejects.toThrow('capture unavailable');
  expect(document.querySelector('[id^="export-chart-"]')).toBeNull();
});
