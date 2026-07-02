import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { LocalizationProvider } from '@/modules/localization';
import { StreamControls } from './StreamControls';

const STREAM_ID = 'stream-1';
const mutationCalls: Array<{ name: string; args: unknown }> = [];

vi.mock('../query/hooks', () => ({
  useStartStream: () => ({
    mutateAsync: async (streamId: string) => {
      mutationCalls.push({ name: 'startStream', args: streamId });
      return {
        outcome: 'fully_executable',
        readyTaskIds: ['t1'],
        blockedTaskIds: [],
        issues: [],
        snapshotId: 'snap-1',
        executionPlanVersion: 1,
      };
    },
    isPending: false,
  }),
  usePauseStream: () => ({
    mutateAsync: async (input: { streamId: string }) => {
      mutationCalls.push({ name: 'pauseStream', args: input });
    },
    isPending: false,
  }),
  useResumeStream: () => ({
    mutateAsync: async (input: { streamId: string }) => {
      mutationCalls.push({ name: 'resumeStream', args: input });
    },
    isPending: false,
  }),
  useStopStream: () => ({
    mutateAsync: async (input: { streamId: string }) => {
      mutationCalls.push({ name: 'stopStream', args: input });
    },
    isPending: false,
  }),
}));

function TestProviders({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <LocalizationProvider>{children}</LocalizationProvider>
    </QueryClientProvider>
  );
}

function renderControls(props: { status: string; controlState: string }) {
  return render(
    <TestProviders>
      <StreamControls
        streamId={STREAM_ID}
        status={props.status as never}
        controlState={props.controlState as never}
      />
    </TestProviders>,
  );
}

beforeEach(() => {
  mutationCalls.length = 0;
});

describe('StreamControls', () => {
  it('shows the success message when start validation returns fully_executable', async () => {
    renderControls({ status: 'created', controlState: 'active' });
    fireEvent.click(screen.getByText('controls.start'));
    await waitFor(() => {
      expect(screen.getByTestId('stream-validation-message').textContent).toContain(
        'controls.fully_executable',
      );
    });
    expect(mutationCalls[0]).toEqual({ name: 'startStream', args: STREAM_ID });
  });

  it('keeps Start clickable when status is already active', async () => {
    renderControls({ status: 'active', controlState: 'active' });
    fireEvent.click(screen.getByText('controls.start'));
    await waitFor(() => {
      expect(mutationCalls.find((c) => c.name === 'startStream')).toBeDefined();
    });
  });

  it('keeps all controls clickable when status is terminal', async () => {
    renderControls({ status: 'stopped', controlState: 'stopped' });
    fireEvent.click(screen.getByText('controls.start'));
    fireEvent.click(screen.getByText('controls.pause'));
    fireEvent.click(screen.getByText('controls.resume'));
    fireEvent.click(screen.getByText('controls.stop'));
    await waitFor(() => {
      expect(mutationCalls.map((c) => c.name)).toEqual(
        expect.arrayContaining(['startStream', 'pauseStream', 'resumeStream', 'stopStream']),
      );
    });
  });

  it('invokes pause mutation when the Pause button is clicked', async () => {
    renderControls({ status: 'active', controlState: 'active' });
    fireEvent.click(screen.getByText('controls.pause'));
    await waitFor(() => {
      expect(mutationCalls.find((c) => c.name === 'pauseStream')).toBeDefined();
    });
  });

  it('invokes resume mutation when the Resume button is clicked', async () => {
    renderControls({ status: 'paused', controlState: 'paused' });
    fireEvent.click(screen.getByText('controls.resume'));
    await waitFor(() => {
      expect(mutationCalls.find((c) => c.name === 'resumeStream')).toBeDefined();
    });
  });
});
