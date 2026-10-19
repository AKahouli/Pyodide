import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from './OpenUiRenderer';
import { dashboardExamples } from './dashboard-examples';
import { projectOpenUiProgram } from './plain-text';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));

describe('reusable dashboard composition', () => {
  it.each(['sales', 'operations'] as const)('restores unsubmitted typed %s state and reactive SVG without an agent action', async app => {
    const user = userEvent.setup(); const onAction = vi.fn(); const update = vi.fn();
    const props = { content: dashboardExamples[app], isStreaming: false, onAction, onStateUpdate: update };
    const view = render(<OpenUiRenderer {...props} />);
    const input = await screen.findByRole('spinbutton');
    await user.clear(input); await user.type(input, app === 'sales' ? '100' : '3');
    await user.click(screen.getByRole('checkbox'));
    const saved = JSON.parse(JSON.stringify(update.mock.calls.at(-1)![0]));
    view.unmount(); render(<OpenUiRenderer {...props} initialState={saved} />);
    expect(await screen.findByRole('spinbutton')).toHaveValue(app === 'sales' ? 100 : 3);
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', app === 'sales');
    const svg = screen.getByRole('img', { name: app === 'sales' ? 'Mean revenue' : 'Service flow' });
    if (app === 'sales') expect(svg).toHaveTextContent('45.00');
    else expect(svg.querySelector('g')).toHaveAttribute('transform', 'translate(-130 0)');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('projects a saved static SVG with its accessible caption and complete shape tree', async () => {
    const capture = vi.fn(async () => 'data:image/png;base64,aGVsbG8=');
    const parts = await projectOpenUiProgram('root = Card([figure])\nfigure = Svg([Rect(0, 0, 20, 20, "primary"), SvgText("Zero: 0", 10, 10)], "0 0 20 20", null, null, "Saved diagram")', undefined, capture);
    expect(parts).toEqual([{ kind: 'image', source: 'data:image/png;base64,aGVsbG8=', caption: 'Saved diagram' }]);
    expect(capture).toHaveBeenCalledWith('Svg', expect.objectContaining({ children: expect.arrayContaining([expect.objectContaining({ typeName: 'Rect' })]) }));
  });

  it('fails explicitly when SVG capture is unavailable and retains dynamic export rejection', async () => {
    await expect(projectOpenUiProgram('root = Card([Svg([], "0 0 20 20")])')).rejects.toThrow('SVG export requires visual capture');
    await expect(projectOpenUiProgram(dashboardExamples.sales, undefined, vi.fn())).rejects.toThrow('Invalid or interactive OpenUI export');
  });
});
