// The settings' "Notifications", under its buttons (#notify-leave, its React root): with the computer's notifications
// on, why this browser shows none -- it has none, or the reader blocked them -- or, its leave not given yet, a button
// asking for it.
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";

/** The computer's notifications wanted (`system`), and this browser's leave for them: "granted", "denied", "default"
 * (not asked yet), or "none" (a browser with none). */
interface LeaveState {
  system: boolean;
  leave: string;
}
const useLeave = create<LeaveState>()(() => ({ system: false, leave: "default" }));

/** This browser's leave as it is now. */
const leaveNow = (): string => ("Notification" in window ? Notification.permission : "none");

function Leave() {
  const { system, leave } = useLeave();
  if (!system || leave === "granted") return null;
  if (leave === "none") return <span className="cfg-note">This browser doesn't support notifications</span>;
  if (leave === "denied")
    return <span className="cfg-note">Blocked. Allow notifications in the browser's site settings.</span>;
  const asked = () => useLeave.setState({ leave: leaveNow() });
  return (
    <button type="button" onClick={() => Notification.requestPermission().then(asked, asked)}>
      Allow notifications…
    </button>
  );
}

let root: { node: HTMLElement; root: Root } | null = null;
/** The note drawn, at once, for the computer's notifications wanted or not (`system`). */
export function drawLeave(system: boolean): void {
  const node = document.getElementById("notify-leave");
  if (!node) return;
  if (root?.node !== node) {
    root = { node, root: createRoot(node) };
    const r = root.root;
    flushSync(() => r.render(<Leave />));
  }
  flushSync(() => useLeave.setState({ system, leave: leaveNow() }));
}
