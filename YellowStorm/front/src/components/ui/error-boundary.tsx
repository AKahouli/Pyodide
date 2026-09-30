import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Rendered instead of `children` after a crash. Receives the error and a reset
   * callback so the surface can offer a "try again" that remounts the subtree.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Optional label announced to assistive tech when the boundary trips. */
  label?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Minimal class error boundary.
 *
 * A render crash inside the conversation column or the preview panel should
 * degrade to a recoverable panel, not blank the whole session. React still
 * requires a class component for this.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role='alert'
        className='flex size-full flex-col items-center justify-center gap-3 p-6 text-center'
      >
        <TriangleIcon className='size-8 text-fail' aria-hidden />
        <p className='text-sm font-medium text-foreground'>{this.props.label ?? 'Something went wrong'}</p>
        <Button type='button' variant='outline' size='sm' onClick={this.reset} className='gap-2'>
          <RefreshCwIcon className='size-3.5' aria-hidden />
          Try again
        </Button>
      </div>
    );
  }
}

/**
 * Convenience wrapper for a vertically-stacked (non-full-bleed) slot, e.g. the
 * conversation column inside a flex row.
 */
export function PanelErrorBoundary({
  children,
  className,
  label,
  onError,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}) {
  return (
    <ErrorBoundary label={label} onError={onError}>
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>{children}</div>
    </ErrorBoundary>
  );
}
