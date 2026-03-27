import { Loader } from '@/components/ai-elements/loader';

export function LoadingIndicator() {
  return (
    <div className='flex items-center gap-2 py-2 text-muted-foreground text-sm'>
      <Loader />
    </div>
  );
}

export function StreamingCursor() {
  return <span className='inline-block w-0.5 h-4 bg-foreground ml-0.5 animate-pulse' />;
}
