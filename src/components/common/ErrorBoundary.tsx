import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches render/runtime errors anywhere in the tree
 * and shows a recoverable screen instead of a blank white page in production.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the details for debugging; wire to a real reporter in production.
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-8">
        <div className="max-w-md w-full bg-card border border-border rounded-lg shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground mt-2">
            An unexpected error interrupted this page. Your saved data is safe.
          </p>
          {error.message && (
            <pre className="mt-4 text-left text-xs bg-muted text-muted-foreground rounded-md p-3 overflow-auto max-h-32 whitespace-pre-wrap break-words">
              {error.message}
            </pre>
          )}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
            >
              <RefreshCw size={16} /> Try again
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="px-4 py-2 bg-muted border border-border text-sm font-medium rounded-md hover:bg-accent transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
