import type { ComponentProps } from 'react';
import { ArrowUp } from 'lucide-react';
import { PromptInputSubmit, usePromptInputController } from './prompt-input';

/** Reads the provider so restored drafts and suggestion clicks update readiness too. */
export function ContentAwareSubmit({ hasCompletedFiles, disabled, status, ...props }: ComponentProps<typeof PromptInputSubmit> & { hasCompletedFiles: boolean }) {
  const { textInput } = usePromptInputController();
  const hasContent = Boolean(textInput.value.trim()) || hasCompletedFiles;
  return <PromptInputSubmit {...props} status={status} disabled={disabled || !hasContent}>
    {!status || status === 'ready' ? <ArrowUp aria-hidden='true' className='size-4' /> : undefined}
  </PromptInputSubmit>;
}
