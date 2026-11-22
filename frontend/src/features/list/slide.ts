// Where each gatherer's actors were put when the list was last drawn: channel -> place, top first.
// So that a row moved by a change (an actor closed into its fold, a folder opened above it) does not jump to its new
// place, each row, group heading and gatherer is keyed (data-key) -- React keeps it the same element from one draw to
// the next (AgentList.tsx) -- its place and status taken before the list is drawn again (listPlaces), and after it
// (slideList) set back where it was and moved to where it is now. An actor whose status changed, and so its group,
// slides over the others; one new to the list fades in; its status dot grows into its new state. None of it for a
// reader who asks for less motion.

/** A row's place before the list is drawn again: its top, its status (its dot's word), its group. */
export type Places = Map<string, { top: number; status: string | null; group: string | undefined }>;

export function listPlaces(root: HTMLElement): Places {
  const places: Places = new Map();
  for (const n of root.querySelectorAll<HTMLElement>("[data-key]")) {
    const dot = n.querySelector(":scope > .a-main > .dot");
    places.set(n.dataset.key!, {
      top: n.getBoundingClientRect().top,
      status: dot && dot.getAttribute("aria-label"),
      group: n.dataset.group,
    });
  }
  return places;
}
export function slideList(root: HTMLElement, was: Places): void {
  if (!was.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const side = getComputedStyle(root).backgroundColor;
  for (const n of root.querySelectorAll<HTMLElement>("[data-key]")) {
    const before = was.get(n.dataset.key!);
    if (!before) {
      n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" });
      continue;
    }
    const dot = n.querySelector(":scope > .a-main > .dot"),
      changed = !!dot && !!before.status && dot.getAttribute("aria-label") !== before.status;
    const regrouped = changed || (!!before.group && n.dataset.group !== before.group);
    const dy = before.top - n.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) {
      const frames: Keyframe[] = [{ transform: `translateY(${dy}px)` }, { transform: "none" }];
      if (regrouped) {
        // past the rows between: over them, on the list's own background if it has none
        n.style.position = "relative";
        n.style.zIndex = "1";
        const bg = getComputedStyle(n).backgroundColor;
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
          frames[0].backgroundColor = side;
          frames[1].backgroundColor = side;
        }
      }
      n.animate(frames, { duration: 380, easing: "cubic-bezier(.2, .8, .2, 1)" }).onfinish = () => {
        n.style.position = n.style.zIndex = "";
      };
    }
    if (changed)
      dot!.animate(
        [
          { transform: "scale(.2)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        {
          duration: 320,
          delay: 120,
          easing: "ease-out",
          fill: "backwards",
        },
      );
  }
}
