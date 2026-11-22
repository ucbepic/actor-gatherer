// THE HOVER CARD (#actor-card): what a row of the list or a tile of the rail is, shown while it is hovered (or in focus
// from the keys) -- an actor's (who it is, its status, what it was asked, its recap, its branch), a task's and an app's
// (live: their items and notifications, each a button), a folder's and a gatherer's (CardFolder.tsx). The page decides
// which card shows, where, and when (features/list/hover-card.ts's cardDraw); this draws it, each part by its key, so a box
// in it -- a name being typed, the question a folder's × asks -- stays the same element as it is drawn again.
import { compact, firstLine } from "../../core/format";
import { appItem, key, taskId } from "../../core/model/keys";
import { Html } from "../../core/ui/PageNode";
import { FolderCard, GathererCard } from "./CardFolder";
import { TabLine, type CardHost, type CardModel } from "./CardParts";
import { AppCard, TaskCard } from "./CardTask";
import { askedOf } from "./envelope";
import { titleOf } from "./groups";
import { Face } from "./Parts";
import { railName } from "./rail-model";
import { isCoordinator, savedAs, statusOf } from "./status";
import { taskOf } from "./tasks";
import type { Actor, Gatherer } from "./types";

export type { CardHost, CardModel } from "./CardParts";

/** The card, as the page has it now. */
export function Card({ m, host }: { m: CardModel; host: CardHost }) {
  const w = m.what;
  switch (w.kind) {
    case "actor":
      return <ActorCard key={key(w.g.name, w.a.channel)} host={host} g={w.g} a={w.a} shown={w.shown} />;
    case "task":
      return <TaskCard key={key(w.g.name, `task:${w.t.id}`)} host={host} g={w.g} t={w.t} edit={m.edit} />;
    case "app":
      return <AppCard key={key(w.g.name, appItem(w.o.id))} host={host} g={w.g} o={w.o} edit={m.edit} />;
    case "folder":
      return <FolderCard key={key(w.g.name, `folder:${w.f.id}`)} host={host} w={w} edit={m.edit} />;
    case "gatherer":
      return <GathererCard key={key(w.g.name, "gatherer:")} host={host} w={w} edit={m.edit} />;
  }
}

/** A path's end, where it tells one actor's from another's: its worktree, its project. */
const tail = (t: string, n: number) => (t.length > n ? "…" + t.slice(-(n - 1)) : t);

/** An actor's card: its face and name, its gatherer and harness, its directory, its status, when it last did something
 * and its size, what it was last asked (under its name, if it has one), its recap, what runs in the background, its
 * branch, the tab it is open in; a hint at its foot. */
function ActorCard({ host, g, a, shown }: { host: CardHost; g: Gatherer; a: Actor; shown: boolean }) {
  const { ctx } = host;
  const [cls, label] = statusOf(ctx, a),
    nm = railName(a),
    size = a.real_tokens ?? a.sent_tokens;
  const asked = askedOf(a.last_user_message),
    bg = a.background || [],
    dir = host.cwdOf(a);
  // one hint, the same wherever the card shows (the list, the rail, shown or not): every way to use the row
  const hint = host.snapshot
    ? ["Click to show it"]
    : [
        `Click to show it · ${host.besideKey}+click to open side by side`,
        `double-click the name (or F2) to ${a.name && a.name.text ? "rename" : "name"} it`,
      ];
  if (shown && !host.snapshot && host.nameNote(g, a).trim()) hint.unshift(host.nameNote(g, a).trim());
  const t = taskOf(ctx, g.name, a);
  return (
    <>
      <div className="c-who">
        <Face host={host} a={a} />
        <div className="tx">
          <div className={"c-nm" + (nm.cls ? ` ${nm.cls}` : "")}>{nm.text}</div>
          <div className="c-sub">{`${titleOf(ctx, g)} · ${host.harnessName(a.harness)}`}</div>
        </div>
      </div>
      {dir ? (
        <div className="c-dir" title={dir}>
          {tail(host.tilde(dir), 44)}
        </div>
      ) : null}
      <div className="c-st">
        <span className={`status ${cls}`}>
          <i aria-hidden="true" />
          {label}
        </span>
        <span>
          <span data-ago={a.last || ""}>{host.ago(a.last)}</span>
          {size !== null && size !== undefined ? ` · ${compact(size)} tokens` : null}
        </span>
        {/* saved: said here, the rail's bookmark showing only while hovered */}
        {!isCoordinator(a) && savedAs(ctx, g.name, a) ? (
          <span className="c-saved">
            <Html node={host.saveIcon(true)} />
            Saved
          </span>
        ) : null}
      </div>
      {asked && nm.cls !== "unnamed" ? (
        <div className="c-asked">
          <span className="lbl">Asked</span>
          {firstLine(asked, 400)}
        </div>
      ) : null}
      {a.recap && a.recap.text ? (
        <div className="c-recap">
          <span className="lbl">Recap</span>
          {a.recap.text}
        </div>
      ) : null}
      {bg.length ? (
        <div className="c-bg">{`${bg.length} in background · ${bg.map((b) => b.label || b.id).join(", ")}`}</div>
      ) : null}
      <Html node={host.branch(g, a)} />
      <TabLine host={host} k={key(g.name, t === null ? a.channel : taskId(t))} />
      <div className="c-hint">{hint.join(" · ")}</div>
    </>
  );
}
