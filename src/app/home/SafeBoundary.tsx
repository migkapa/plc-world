/** Error boundary for optional page decorations (e.g. the 3D hero): renders `fallback` instead of crashing the page. */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface SafeBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
  /** Called once when the children failed and the fallback took over (e.g. to hide related overlays). */
  onError?: (error: unknown) => void;
}

export class SafeBoundary extends Component<SafeBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('[PLC World] optional view failed and was replaced by a fallback:', error, info.componentStack);
    this.props.onError?.(error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
