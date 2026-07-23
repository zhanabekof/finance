import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  message: string | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    console.error(error);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="app-shell" style={{ padding: "2rem" }}>
          <h1>Что-то пошло не так</h1>
          <p role="alert">{this.state.message}</p>
          <button type="button" onClick={() => this.setState({ message: null })}>
            Попробовать снова
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
