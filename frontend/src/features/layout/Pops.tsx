// The page's drop-downs and boxes hung from a button (or a point), one at a time: a menu -- a panel's moves, what can
// start in a place, the new-tab page's "In" and "On", the list's moves -- as Radix's DropdownMenu (arrow keys, Home/End,
// typing a letter, Esc giving the focus back to the button), and a box to fill in -- a new actor's directory and harness,
// an app's folder -- as Radix's Popover, its form the page's own node. Each placed by Radix under its button (from the
// rail, beside it), flipped above where there is no room, and closed by its button pressed again, a press elsewhere, Esc,
// the page resizing, or the page or a box holding its button scrolling. The page says what each holds and what a choice
// does (features/layout/panes.js's openPop, popMenu); the look is the page's (.br-menu.row-menu, .dw-menu).
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Html } from "../../core/ui/PageNode";

/** A choice of a menu: its mark (a node of the page's) or icon, what it is, a note under it; or a separator. */
export interface PopItem {
  sep?: boolean;
  mark?: Node | null;
  icon?: string;
  text: string;
  note?: string | null;
  depth?: number;
  run: (button: HTMLElement) => void;
}
/** A menu: its heading (`title` its tooltip, `sub` a muted second line), its choices, a class of its own. */
export interface PopMenu {
  head: string;
  title?: string | null;
  sub?: string | null;
  items: PopItem[];
  cls?: string;
}
/** What is open: hung from `anchor` (a button, found again by its data-pop, `key`), a menu or a box (the page's node). */
export interface Pop {
  key: string;
  anchor: HTMLElement;
  menu?: PopMenu;
  box?: HTMLElement;
}
/** What the pop-ups ask of the page: an icon's node (by its name or its SVG path); that one closed (its button told). */
export interface PopsHost {
  icon(icon: string, size: number): Node;
  closed(pop: Pop, how: "esc" | "chosen" | "away"): void;
}

let root: Root | null = null;
let host: PopsHost | null = null;
let shown: Pop | null = null;

/** The pop-ups' place on the page, and what they ask of it: once, as the page starts. */
export function startPops(h: PopsHost): void {
  host = h;
  if (root) return;
  const node = document.createElement("div");
  node.className = "pops";
  document.body.append(node);
  root = createRoot(node);
}

/** `pop` shown (null: none), at once. */
export function showPop(pop: Pop | null): void {
  shown = pop;
  if (!root) return;
  flushSync(() => root!.render(pop ? <Shown key={pop.key + "\u0000" + (pop.menu ? "m" : "b")} pop={pop} /> : null));
}
/** The pop-up shown, if one is. */
export const popShown = (): Pop | null => shown;

// the one shown closed, as `how` says
const close = (pop: Pop, how: "esc" | "chosen" | "away") => {
  if (shown !== pop) return;
  showPop(null);
  host?.closed(pop, how);
};
// a press on its own button: not one away -- the button's click opens or closes it
const onItsButton = (pop: Pop, t: EventTarget | null) =>
  t instanceof Element && !!t.closest(`[data-pop="${CSS.escape(pop.key)}"]`);

function Shown({ pop }: { pop: Pop }): ReactNode {
  // closed as the page resizes, or the page or a box holding its button scrolls: it no longer hangs where it should
  // (another box scrolling by itself -- a Chat's history kept at its end as its pane is resized -- leaves it be)
  useEffect(() => {
    const away = () => close(pop, "away");
    const scrolled = (ev: Event) => {
      const t = ev.target;
      if (t instanceof Node && !(t instanceof Element && t.closest(".pop-box, .br-menu")) && t.contains(pop.anchor))
        close(pop, "away");
    };
    window.addEventListener("resize", away);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [pop]);
  // from the rail down the page's side: beside it, level with its button; else under it
  const rail = pop.anchor.closest("#rail"),
    r = rail?.getBoundingClientRect();
  const side = r && r.height > r.width ? "right" : "bottom";
  return pop.menu ? <MenuPop pop={pop} menu={pop.menu} side={side} /> : <BoxPop pop={pop} side={side} />;
}

// the anchor's place, for a trigger of Radix's laid over it (it never takes a press: the page's button does)
function overStyle(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  return {
    position: "fixed" as const,
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    pointerEvents: "none" as const,
    visibility: "hidden" as const,
  };
}

function MenuPop({ pop, menu, side }: { pop: Pop; menu: PopMenu; side: "right" | "bottom" }) {
  const how = useRef<"esc" | "chosen" | "away">("away");
  const content = useRef<HTMLDivElement>(null),
    first = useRef(false);
  return (
    <Menu.Root modal={false} open onOpenChange={(open) => (open ? undefined : close(pop, how.current))}>
      <Menu.Trigger asChild>
        <span aria-hidden="true" style={overStyle(pop.anchor)} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          ref={content}
          className={"br-menu row-menu" + (menu.cls ? ` ${menu.cls}` : "")}
          aria-label={menu.head}
          aria-labelledby={undefined} // (named by its heading, not by the trigger laid over its button)
          side={side}
          align="start"
          sideOffset={side === "right" ? 6 : 4}
          collisionPadding={8}
          style={{ position: "relative" }}
          // the first choice in focus as it opens (Radix gives the menu the focus), as the page's drop-downs had it
          onFocus={(ev) => {
            if (ev.target !== ev.currentTarget || first.current) return;
            first.current = true;
            content.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
          }}
          // the focus back on its button after an Esc; a choice's own (a box it opened) after a choice
          onCloseAutoFocus={(ev) => ev.preventDefault()}
          onEscapeKeyDown={(ev) => {
            ev.stopPropagation(); // the menu's Esc, not the list's too
            how.current = "esc";
          }}
          onPointerDownOutside={(ev) => {
            if (onItsButton(pop, ev.target)) ev.preventDefault();
          }}
          onFocusOutside={(ev) => ev.preventDefault()}
        >
          <div className="hd" title={menu.title || undefined}>
            {menu.head}
            {menu.sub ? <span className="sub">{menu.sub}</span> : null}
          </div>
          {menu.items.map((it, i) =>
            it.sep ? (
              <Menu.Separator key={`sep${i}`} className="sep" />
            ) : (
              <Menu.Item
                key={`${i}:${it.text}`}
                asChild
                onSelect={() => {
                  how.current = "chosen";
                  const button = pop.anchor;
                  close(pop, "chosen");
                  it.run(button);
                }}
              >
                <button type="button" style={it.depth ? { paddingLeft: `${10 + it.depth * 14}px` } : undefined}>
                  <Html node={it.mark || host?.icon(it.icon || "", 16) || null} />
                  <span className="nm">{it.text}</span>
                  {it.note ? <span className="at">{it.note}</span> : null}
                </button>
              </Menu.Item>
            ),
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

// the page's form `box` put in `at`, laid out in the pop-up (not fixed where the page put it before); taken out again
function hostBox(at: HTMLElement, box: HTMLElement): () => void {
  box.style.position = "relative";
  at.append(box);
  return () => box.remove();
}

function BoxPop({ pop, side }: { pop: Pop; side: "right" | "bottom" }) {
  const how = useRef<"esc" | "away">("away");
  // (put in as its place is made: the portal draws it a moment after the pop-up)
  const into = useCallback((at: HTMLDivElement | null) => (at ? hostBox(at, pop.box!) : undefined), [pop]);
  return (
    <Popover.Root open onOpenChange={(open) => (open ? undefined : close(pop, how.current))}>
      <Popover.Anchor virtualRef={{ current: pop.anchor }} />
      <Popover.Portal>
        <Popover.Content
          className="pop-box"
          role="presentation"
          side={side}
          align="start"
          sideOffset={side === "right" ? 6 : 4}
          collisionPadding={8}
          style={{ zIndex: "var(--z-menu)", outline: "none" }}
          // its first box in focus, the caret at its end (a folder's end in sight)
          onOpenAutoFocus={(ev) => {
            ev.preventDefault();
            const first = pop.box!.querySelector<HTMLElement>("input, [role=menuitem], button");
            if (!first) return;
            first.focus({ preventScroll: true });
            if (first instanceof HTMLInputElement) {
              first.setSelectionRange(first.value.length, first.value.length);
              first.scrollLeft = first.scrollWidth;
            }
          }}
          onCloseAutoFocus={(ev) => ev.preventDefault()}
          onEscapeKeyDown={(ev) => {
            ev.stopPropagation();
            how.current = "esc";
          }}
          onPointerDownOutside={(ev) => {
            if (onItsButton(pop, ev.target)) ev.preventDefault();
          }}
          onFocusOutside={(ev) => ev.preventDefault()}
        >
          <div ref={into} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
