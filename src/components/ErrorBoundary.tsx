import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  failed: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(_error: unknown): State {
    return { failed: true };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Avoid logging error payloads — they may contain titles, amounts, or other PII.
    console.error("Unhandled UI error");
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="app-shell" style={{ padding: "2rem" }}>
          <h1>Что-то пошло не так</h1>
          <p role="alert">Приложение столкнулось с ошибкой. Попробуйте снова.</p>
          <button type="button" onClick={() => this.setState({ failed: false })}>
            Попробовать снова
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
