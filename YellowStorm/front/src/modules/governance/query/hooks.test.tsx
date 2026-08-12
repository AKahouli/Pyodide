import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { governanceQueryKeys } from './queryKeys';
import { useUpdateGovernanceProgram } from './hooks';

const mocks = vi.hoisted(() => ({
  updateProgram: vi.fn(),
}));

vi.mock('../api', () => ({
  governanceApi: { updateProgram: mocks.updateProgram },
}));

describe('useUpdateGovernanceProgram', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates the selected program and invalidates the program list', async () => {
    mocks.updateProgram.mockResolvedValue({ id: 'program-1', name: 'Renamed program' });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useUpdateGovernanceProgram('program-1'), { wrapper });

    act(() => result.current.mutate({ name: 'Renamed program' }));

    await waitFor(() => expect(mocks.updateProgram).toHaveBeenCalledWith('program-1', { name: 'Renamed program' }));
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: governanceQueryKeys.programs() }));
  });
});
