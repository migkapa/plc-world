import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { Button } from '../ui';

interface Props {
  children: ReactNode;
  /** Changing this key clears the error (the current route). */
  resetKey: string;
}

interface State {
  error: Error | null;
}

class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PLC World] page crashed', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <TriangleAlert size={40} className="text-safety" />
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Major fault on this page</h1>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            Something went wrong while rendering. Your progress is saved — reload to clear the fault.
          </p>
          <pre className="mt-3 max-w-xl overflow-auto rounded-lg border border-edge bg-black/40 p-3 text-left font-mono text-xs text-red-300">
            {error.message}
          </pre>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" icon={<RotateCcw size={16} />} onClick={() => location.reload()}>
            Reload
          </Button>
          <Button onClick={() => (location.hash = '#/')}>Go home</Button>
        </div>
      </div>
    );
  }
}

/** Error boundary around routed pages: a crashing page shows a recoverable fault screen instead of a blank app. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <Boundary resetKey={location}>{children}</Boundary>;
}
