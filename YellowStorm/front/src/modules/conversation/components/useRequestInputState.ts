import { useAuth } from '@/modules/auth/useAuth';
import { useRootInputUiStore } from '../rootInputUiStore';
import { nativeInputKey } from './native-input-presentation';

export function useRequestInputState(conversationId: string, messageId: string) {
  const { user } = useAuth();
  const state = useRootInputUiStore();
  if (!user?.id || state.scope !== `${user.id}:${conversationId}`) return undefined;
  const keys = state.roots.filter((root) => root.originAssistantMessageId === messageId)
    .flatMap((root) => root.inputs.map((input) => nativeInputKey(root, input)));
  if (!keys.length) return undefined;
  if (keys.some((key) => state.submitting.includes(key))) return 'sending' as const;
  if (keys.some((key) => !state.submitted.includes(key))) return 'waiting' as const;
  return 'continuing' as const;
}
