// A turn that fails to draw (its data not as the turn list expects, a renderer that throws): said so in its place, the
// error logged -- not the whole conversation unmounted with it. Drawn again once its turn changes.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** the turn's number, for its place (its box's id) */
  n: number;
  /** what the turn is drawn from: another, and it is tried again */
  of: unknown;
  children: ReactNode;
}

export class TurnBoundary extends Component<Props, { failed: Error | null; of: unknown }> {
  state = { failed: null as Error | null, of: this.props.of };

  static getDerivedStateFromError(failed: Error) {
    return { failed };
  }

  static getDerivedStateFromProps(props: Props, state: { failed: Error | null; of: unknown }) {
    return props.of === state.of ? null : { failed: null, of: props.of };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error(`Chat: turn ${this.props.n} not drawn`, err, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fl-turn" id={`fl-turn-${this.props.n}`}>
        <div className="warn">{`This turn could not be drawn: ${this.state.failed.message}`}</div>
      </div>
    );
  }
}
