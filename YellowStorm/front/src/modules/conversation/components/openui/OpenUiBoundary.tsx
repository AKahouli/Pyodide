import { Component, type ReactNode } from 'react';

interface OpenUiBoundaryProps {
  /** A new key clears a caught error and renders the children again. */
  resetKey: string;
  fallback: (error: Error) => ReactNode;
  onError?: (error: Error) => void;
  children: ReactNode;
}

interface OpenUiBoundaryState {
  error: Error | null;
  resetKey: string;
}

/**
 * Error boundary that retries: a render crash caused by half-parsed streaming
 * content must not stick, so the error is dropped as soon as `resetKey`
 * (the content and streaming state) changes.
 */
export class OpenUiBoundary extends Component<OpenUiBoundaryProps, OpenUiBoundaryState> {
  state: OpenUiBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<OpenUiBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: OpenUiBoundaryProps, state: OpenUiBoundaryState): Partial<OpenUiBoundaryState> | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
