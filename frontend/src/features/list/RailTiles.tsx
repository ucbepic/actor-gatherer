// THE RAIL'S TILES (rail-model.ts's RTile): an actor's -- its avatar, its status's dot at its corner, its name in small
// under it, its bookmark and × over its corners while hovered -- a task's (its lead's face, how many it holds, its apps'
// mark) and an app's in no task. Pressed: shown (Shift+click selects an actor with others); dragged: put in a folder, or
// (a task's, an app's) another item dropped on it put in its task.
import { createContext, Fragment, useContext, type MouseEvent, type ReactNode } from "react";
import { Html } from "../../core/ui/PageNode";
import { titleOf } from "./groups";
import { Face, useSpin } from "./Parts";
import type { RActor, RApp, RTask } from "./rail-model";
import type { RailHost } from "./Rail";
import { actorSave, closeButton, drags, joins, PickCheck, saveButton } from "./RowViews";
import { appTitle } from "./tasks";
import type { AppItem } from "./types";

/** How many times the rail has been drawn: a tile's bookmark and × are made anew at each draw, as the whole rail was
 * before it was React's -- so a press on one keeps no focus that would hold them shown, and a draw under a resting
 * pointer gives the pointer a new one (the tile itself stays: hovered, in focus from the keys, dragged). */
export const RailDraw = createContext(0);
function Corners({ children }: { children: ReactNode }) {
  return <Fragment key={useContext(RailDraw)}>{children}</Fragment>;
}

export function ActorTile({ n, host }: { n: RActor; host: RailHost }) {
  const { g, a, name: nm } = n,
    [cls, label] = n.status;
  const spin = useSpin();
  const snap = host.snapshot,
    t = titleOf(host.ctx, g);
  const drag = snap || n.coordinator ? {} : drags(host, (ev) => host.dragActor(ev, g, a));
  const close =
    n.close &&
    closeButton(
      host,
      n.close === "close" ? "Close this session, even mid-turn" : "Never started · remove it from the list",
      "Close session",
      () => host.closeActor(g, a, n.close!),
    );
  return (
    <button
      className={"r-actor" + (n.picked ? " picked" : "")}
      type="button"
      data-card={n.card}
      aria-current={n.current ? "true" : "false"}
      data-open={n.open ? "true" : undefined}
      aria-label={`${nm.text}, in ${t}: ${label}`}
      // where there is no hovering (a touch screen), the card's words as its title
      title={host.hovers() ? undefined : `${nm.text}\n${label} · ${host.ago(a.last)} · ${t}`}
      onClick={(ev: MouseEvent) => {
        host.cardHide(ev);
        if (ev.shiftKey && !snap && !n.coordinator) {
          ev.preventDefault();
          host.togglePick(g, a);
          return;
        }
        host.pick(g.name, a.channel, ev);
      }}
      onContextMenu={(ev) => host.pickBeside(g.name, a.channel, ev)}
      {...drag}
    >
      <span className="r-pic">
        <Face host={host} a={a} check={n.checked ? <PickCheck host={host} g={g} a={a} /> : null} />
        <i className={`rd ${cls}`} aria-hidden="true" style={spin} />
      </span>
      <span className={"r-name" + (nm.cls === "none" ? " none" : "")} aria-hidden="true">
        {nm.text}
      </span>
      {/* the list's bookmark and ×, in the corners over its avatar: shown while hovered, in focus or the one shown */}
      <Corners>
        {actorSave(host, g, a, n.saved)}
        {close || null}
      </Corners>
    </button>
  );
}

/** The mark of a tile's apps: its first app's, at its avatar's top right corner. */
function RailApps({ host, apps }: { host: RailHost; apps: AppItem[] }) {
  return (
    <span className="r-apps" title={[...new Set(apps.map((o) => o.app.label))].join(", ")}>
      <Html node={host.appMark(apps[0])} />
    </span>
  );
}

export function TaskTile({ n, host }: { n: RTask; host: RailHost }) {
  const { g, t } = n,
    [cls, label] = n.status;
  const spin = useSpin();
  const gt = titleOf(host.ctx, g);
  const drag = n.first ? { ...drags(host, (ev) => host.dragItems(ev, g, n.items)), ...joins(host, g, n.first) } : {};
  return (
    <button
      className="r-actor r-task"
      type="button"
      data-card={n.card}
      aria-current={n.current ? "true" : "false"}
      data-open={n.open ? "true" : undefined}
      aria-label={`${n.name}, a task of ${n.what || "nothing"}, in ${gt}: ${label}`}
      title={host.hovers() ? undefined : `${n.name}\n${n.what} · ${label} · ${gt}`}
      onClick={(ev) => {
        host.cardHide(ev);
        host.openTask(g.name, t.id, ev);
      }}
      {...drag}
    >
      <span className="r-pic">
        <span className="logo r-group">
          {n.face ? <Face host={host} a={n.face} /> : n.faceApp ? <Html node={host.appFace(n.faceApp)} /> : null}
        </span>
        {n.n > 1 ? (
          <span className="r-many" aria-hidden="true">
            {String(n.n)}
          </span>
        ) : null}
        {n.dot ? <i className={`rd ${cls}`} aria-hidden="true" style={spin} /> : null}
        {n.apps.length ? <RailApps host={host} apps={n.apps} /> : null}
      </span>
      <span className="r-name" aria-hidden="true">
        {n.name}
      </span>
      <Corners>
        {n.members > 0
          ? saveButton(
              host,
              n.saved,
              ["", "Save the task for later"],
              ["Unsave the task", "Save the task for later"],
              () => host.saveTask(g.name, t.id, !n.saved),
            )
          : null}
        {!host.snapshot && n.closable
          ? closeButton(host, "Close the task · it reopens as it was", "Close the task", () =>
              host.closeTask(g.name, t.id),
            )
          : null}
      </Corners>
    </button>
  );
}

export function AppTile({ n, host }: { n: RApp; host: RailHost }) {
  const { g, o, told } = n;
  const gt = titleOf(host.ctx, g);
  return (
    <button
      className="r-actor r-app"
      type="button"
      aria-current={n.chosen ? "true" : "false"}
      data-key={`${g.name}/${n.item}`}
      data-open={n.shown ? "true" : undefined}
      data-card={n.card}
      aria-label={`${appTitle(o)}, an app, in ${gt}${told ? `: ${told[1]}` : ""}`}
      title={host.hovers() ? undefined : `${appTitle(o)} · ${gt}`}
      onClick={(ev) => {
        host.cardHide(ev);
        host.selectApp(g.name, o, ev);
      }}
      {...drags(host, (ev) => host.dragItems(ev, g, [n.item]))}
      {...joins(host, g, n.item)}
    >
      <span className="r-pic">
        <Html node={host.appFace(o)} />
        {told ? <i className={`rd ${told[0]}`} aria-hidden="true" /> : null}
      </span>
      <span className="r-name" aria-hidden="true">
        {o.title || o.app.label}
      </span>
      <Corners>
        {host.snapshot
          ? null
          : closeButton(host, `Close ${o.app.label}`, `Close ${o.app.label}`, () => host.closeApp(g.name, o))}
      </Corners>
    </button>
  );
}
