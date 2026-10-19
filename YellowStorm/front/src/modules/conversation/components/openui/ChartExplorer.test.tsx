import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from './OpenUiRenderer';
import { getChartData } from './data-exploration';

const program = 'root = Card([visits])\nvisits = BarChart(["Tokyo", "Paris", "Osaka"], [{category: "Visits", values: [10, 2, 0]}, {category: "Revenue", values: [30, 8, 1]}])';
describe('OpenUI chart exploration', () => {
  beforeEach(() => {
    // jsdom lacks the text measurement canvas used by the stock SVG chart.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D);
  });
  it('drills into a category/series and preserves numeric selections through strict reload', async () => {
    const user = userEvent.setup(); const onAction = vi.fn();
    const view = render(<OpenUiRenderer content={program} isStreaming={false} onAction={onAction} />);
    await user.selectOptions(await screen.findByLabelText('openui.explore.series'), '0');
    await user.click(screen.getByRole('button', { name: 'Osaka' }));
    await user.click(screen.getByRole('button', { name: 'openui.explore.applyChart' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    const event = onAction.mock.calls[0][0];
    expect(event.formState.__ysExplore['chart:visits'].value).toEqual({ seriesIndex: 0, labelIndex: 2 });
    expect(event.params.selectedPoints).toEqual([{ seriesIndex: 0, labelIndex: 2, label: 'Osaka', category: 'Visits', value: 0 }]);
    const saved = JSON.parse(JSON.stringify(event.formState));
    view.unmount();
    render(<StrictMode><OpenUiRenderer content={program} isStreaming={false} onAction={vi.fn()} initialState={saved} /></StrictMode>);
    await waitFor(() => expect(screen.getByLabelText('openui.explore.series')).toHaveValue('0'));
    expect(screen.getByLabelText('openui.explore.category')).toHaveValue('2');
    expect(screen.getByRole('button', { name: 'Osaka' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps all series by default and bounds stale saved indices', () => {
    const series = [{ category: 'Visits', values: [0, 10] }];
    expect(getChartData(['A', 'B'], series, undefined).series).toEqual(series);
    expect(getChartData(['A', 'B'], series, { seriesIndex: 300, labelIndex: 90 }).view).toEqual({ seriesIndex: -1, labelIndex: null });
  });
});
