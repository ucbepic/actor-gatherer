// THE LIST'S OWN BUTTONS, as its shape is (modes.ts): fold it to the rail, or open it again; hide it, or keep it open
// (none over the whole page, nor hiding in a pane's frame) -- at the list's head, and over the rail (#list-btns). And
// every actor over the whole page, or back: in the top bar (#top-full), by the logo.
import { StrokeIcon } from "../../core/ui/Icon";
import type { ListButtonsInfo, ListHost } from "./host";

/** The paths drawn over the sidebar's own (ICONS.sidebar) for each button. */
export const LIST_ICONS = {
  full: "M9.75 2.25h4v4M13.75 2.25l-4.5 4.5M6.25 13.75h-4v-4M2.25 13.75l4.5-4.5",
  unfull: "M13.75 2.25l-4.5 4.5M9.25 3v3.75H13M2.25 13.75l4.5-4.5M6.75 13V9.25H3",
  fold: "M11 6l-2 2 2 2",
  unfold: "M9 6l2 2-2 2",
  hide: "M2.75 2.75v10.5M11 5L8 8l3 3M8 8h5.25",
  keep: "M2.75 2.75v10.5M8.5 5l3 3-3 3M11.5 8H5.5",
};
/** What the buttons call: the list's shape set, its hiding. */
export type ButtonsHost = Pick<ListHost, "setListMode" | "setListHidden" | "iconPath">;

export function ListButtons({ info, host }: { info: ListButtonsInfo; host: ButtonsHost }) {
  const full = info.mode === "full",
    folded = info.mode === "folded";
  const fold = folded ? "Open the list" : "Fold the list";
  return (
    <>
      {full ? null : (
        <button
          className="list-btn lb-fold"
          type="button"
          aria-expanded={folded ? "false" : "true"}
          title={fold}
          aria-label={fold}
          onClick={() => host.setListMode(folded ? "list" : "folded")}
        >
          <StrokeIcon d={host.iconPath("sidebar") + (folded ? LIST_ICONS.unfold : LIST_ICONS.fold)} />
        </button>
      )}
      {full || info.pane ? null : (
        <button
          className="list-btn lb-hide"
          type="button"
          aria-pressed={info.hidden ? "true" : "false"}
          title={info.hidden ? "Keep the list open" : "Hide the list · hover the left edge to show it"}
          aria-label={info.hidden ? "Keep the list open" : "Hide the list"}
          onClick={() => host.setListHidden(!info.hidden)}
        >
          <StrokeIcon d={info.hidden ? LIST_ICONS.keep : LIST_ICONS.hide} />
        </button>
      )}
    </>
  );
}

/** Every actor over the whole page, or back (Esc too). */
export function FullButton({ full, set }: { full: boolean; set: (full: boolean) => void }) {
  return (
    <button
      className="list-btn lb-full"
      type="button"
      aria-pressed={full ? "true" : "false"}
      title={full ? "Back to the list (Esc)" : "Show every actor full screen"}
      aria-label={full ? "Leave full screen" : "Full screen"}
      onClick={() => set(!full)}
    >
      <StrokeIcon d={full ? LIST_ICONS.unfull : LIST_ICONS.full} />
    </button>
  );
}
