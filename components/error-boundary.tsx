"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional render-prop fallback.  Receives the caught error and a reset
   * callback that clears the error state so the subtree re-mounts.
   * If omitted, the built-in DefaultFallback is shown.
   */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// ── Class component (required for getDerivedStateFromError) ────────────────

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Replace with your error-monitoring SDK (Sentry, Datadog, etc.)
    console.error("[GridVision] Render error caught by boundary:", error.message);
    console.error(info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;

    if (error) {
      if (this.props.fallback) {
        return this.props.fallback({ error, reset: this.reset });
      }
      return <DefaultFallback error={error} reset={this.reset} />;
    }

    return this.props.children;
  }
}

// ── Default fallback UI ────────────────────────────────────────────────────

function DefaultFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div role="alert" className="flex min-h-[240px] items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10" aria-hidden="true">
          <span className="font-mono text-sm text-red-400">!</span>
        </div>
        <p className="font-mono text-sm font-semibold text-red-400">
          Unexpected render error
        </p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          {error.message || "An unknown error occurred."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md border border-border/60 px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
