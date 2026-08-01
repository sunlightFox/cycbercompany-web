import { Component, type ReactNode } from "react";
import i18n from "../lib/i18n";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError)
      return (
        <main className="app-error-boundary" role="alert">
          <div>
            <h1>{i18n.t("appUnavailable")}</h1>
            <p>{i18n.t("appUnavailableHint")}</p>
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>
              {i18n.t("reloadApp")}
            </button>
          </div>
        </main>
      );
    return this.props.children;
  }
}
