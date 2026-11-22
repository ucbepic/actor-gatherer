// With a panel open above the panes (the top row), a pane's head is put in its Chat view's folded bar, at the other end
// from the numbers, as small icons -- a grip to move the pane by (dragged, or right-clicked: the layout's MOVE_FROM finds
// it by its class), which view, Details, Minimize where the pane can be, and the pane's close -- and the head itself
// hidden (.pane:has(.fl-acts)), its room the chat's.
import type { ReactNode } from "react";
import { StrokeIcon } from "../../../core/ui/Icon";
import type { ViewChoice } from "../Controls";

/** What the bar shows of the pane's head (the host's paneActs): its views, Details, Minimize, its close. */
export interface PaneActsProps {
  views: ViewChoice[];
  current: string;
  details: boolean;
  detailsTitle: string;
  /** the chat can be minimized: its button's title */
  minimize: string | null;
  closeTitle: string;
  show(id: string): unknown;
  toggleDetails(): unknown;
  doMinimize(): unknown;
  close(): unknown;
}

export function PaneActs({ icons, ...p }: PaneActsProps & { icons: Record<string, string> }) {
  const act = (label: string, title: string, icon: ReactNode, onClick: () => unknown, pressed?: boolean, cls = "") => (
    <button
      key={label}
      type="button"
      className={`fl-act ${cls}`.trim()}
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      onClick={() => onClick()}
    >
      {icon}
    </button>
  );
  return (
    <div className="fl-acts" role="group" aria-label="This pane">
      <span className="fl-act fl-grip" draggable="true" title="Drag or right-click to move" aria-label="Move this pane">
        <StrokeIcon d={icons.move} size={14} />
      </span>
      {p.views.map((v) =>
        act(
          v.name,
          v.description || v.name,
          v.icon ? <StrokeIcon d={v.icon} size={14} /> : v.name.slice(0, 1),
          () => p.show(v.id),
          v.id === p.current,
        ),
      )}
      {act("Details", p.detailsTitle, <StrokeIcon d={icons.info} size={14} />, p.toggleDetails, p.details)}
      {p.minimize
        ? act("Minimize the chat", p.minimize, <StrokeIcon d={icons.minimize} size={14} />, p.doMinimize)
        : null}
      {act("Close this pane", p.closeTitle, <StrokeIcon d={icons.x} size={16} />, p.close, undefined, "close")}
    </div>
  );
}
