import './devtools-off';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { action, createLibrary, defineAction, defineComponent, defineFunction, Renderer, useTriggerAction } from '@openuidev/react-lang';

// The existing renderer/form/report/image/export suites qualify the saved dialect.
// This isolated library verifies that the upgraded runtime really supports 1.0;
// it does not expose functions, actions or autosave to production agents.
const SmokeView = defineComponent({
  name: 'SmokeView',
  description: 'Migration test controls',
  props: z.object({ label: z.string(), increment: action(), submit: action() }),
  component: ({ props }) => {
    const trigger = useTriggerAction();
    return <div><output>{props.label}</output>
      <button onClick={() => trigger('Increment', undefined, props.increment)}>Increment</button>
      <button onClick={() => trigger('Submit', undefined, props.submit)}>Submit</button>
    </div>;
  },
});
const library = createLibrary({
  root: 'SmokeView',
  components: [SmokeView],
  functions: [defineFunction({
    name: 'DescribeCount', description: 'Format a count', params: z.object({ count: z.number() }), returns: z.string(),
    fn: ({ count }) => `Count: ${count}`,
  })],
  actions: [defineAction({ name: 'SaveCount', description: 'Submit the current count', params: z.object({ count: z.number() }) })],
});
const program = '$count = 5\nroot = SmokeView(@DescribeCount($count), Action([@Set($count, $count + 1)]), Action([@SaveCount($count)]))';

describe('OpenUI 1.0 migration runtime qualification', () => {
  it('evaluates registered functions reactively and keeps local actions out of inference', async () => {
    const user = userEvent.setup(); const onAction = vi.fn(); const onStateUpdate = vi.fn();
    render(<Renderer response={program} library={library} onAction={onAction} onStateUpdate={onStateUpdate} />);
    expect(await screen.findByText('Count: 5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Increment' }));
    expect(await screen.findByText('Count: 6')).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
    await waitFor(() => expect(onStateUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ $count: 6 })));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'SaveCount', params: { count: 6 } }));
  });

  it('restores a JSON-roundtripped binding without replacing its typed zero with its default', async () => {
    const user = userEvent.setup(); const onStateUpdate = vi.fn();
    const view = render(<Renderer response={program} library={library} initialState={{ $count: -1 }} onStateUpdate={onStateUpdate} />);
    expect(await screen.findByText('Count: -1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Increment' }));
    await screen.findByText('Count: 0');
    await waitFor(() => expect(onStateUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ $count: 0 })));
    const saved: Record<string, unknown> = JSON.parse(JSON.stringify(onStateUpdate.mock.calls.at(-1)?.[0]));
    view.unmount();
    render(<Renderer response={program} library={library} initialState={saved} />);
    expect(await screen.findByText('Count: 0')).toBeInTheDocument();
  });
});
