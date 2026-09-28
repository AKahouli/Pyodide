import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { semanticModelApi } from '../api';
import { semanticModelQueryKeys } from '../query/queryKeys';
import type { RecordCorrectionInput } from '../types';

/**
 * Fixes people make on the prepared data: a wrong value, a record or link to hide, a missing link.
 * Each fix is kept and replayed on every rebuild; saving one starts a rebuild of the draft.
 */
export function useRecordCorrections(modelId: string, enabled = true) {
  const queryClient = useQueryClient();
  const corrections = useQuery({
    queryKey: semanticModelQueryKeys.corrections(modelId),
    queryFn: () => semanticModelApi.listCorrections(modelId),
    enabled: Boolean(modelId) && enabled,
    retry: false,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.corrections(modelId) });
    void queryClient.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] });
    void queryClient.invalidateQueries({ queryKey: ['semantic-models', 'review-queue', modelId] });
  };
  const record = useMutation({
    mutationFn: (input: RecordCorrectionInput) => semanticModelApi.recordCorrection(modelId, input),
    onSuccess: refresh,
  });
  const undo = useMutation({
    mutationFn: (sequence: number) => semanticModelApi.undoCorrection(modelId, sequence),
    onSuccess: refresh,
  });
  return { corrections, record, undo };
}
