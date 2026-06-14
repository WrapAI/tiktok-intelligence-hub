import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ margin: 24 }}>
          <div className="card-title">Something went wrong</div>
          <p className="error">{this.state.error.message}</p>
          <p className="muted">Try closing all Electron windows and run npm.cmd run dev again.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
