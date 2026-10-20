import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Switch } from './switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

it('forwards the switch button ref for accessible tooltip triggers', async () => {
  const user = userEvent.setup();
  const ref = createRef<HTMLButtonElement>();
  render(<TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild><Switch ref={ref} aria-label='Enable tool' /></TooltipTrigger><TooltipContent>Allow this tool to run.</TooltipContent></Tooltip></TooltipProvider>);
  expect(ref.current).toBe(screen.getByRole('switch', { name: 'Enable tool' }));
  await user.tab();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Allow this tool to run.');
  expect(ref.current).toHaveFocus();
});
