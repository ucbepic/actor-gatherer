// A TASK'S AND AN APP'S HOVER CARD (Card.tsx), live in the list and the rail: a task's name, what it holds, "+" and its
// pencil, its items -- its actors, the lead first, each shown by a click; its apps, each selected by one -- each with its
// own bookmark or close and a mark taking it out of the task; an app's own, its pencil and ×; their notifications, each
// opening its app where it says.
import { plural } from "../../core/format";
import { appItem, key, taskId } from "../../core/model/keys";
import { Html } from "../../core/ui/PageNode";
import { CardAct, EditBox, RowStatus, TabLine, type CardEdit, type CardHost, type Notice } from "./CardParts";
import { titleOf } from "./groups";
import { Face, RowButton } from "./Parts";
import { actorSave, closeButton } from "./RowViews";
import { appKey, appNotices, closeHow, groupOf, LEAD_RANK, savedAs, statusOf } from "./status";
import {
  actorTitle,
  appShown,
  appTaskOf,
  appTitle,
  taskActors,
  taskApps,
  taskLead,
  taskMembers,
  taskName,
} from "./tasks";
import type { Actor, AppItem, Gatherer, Task } from "./types";

/** A task's actors' faces, those not closed (three at most, then how many more), and its apps' marks. */
function TaskFaces({ host, g, t }: { host: CardHost; g: Gatherer; t: Task }) {
  const { ctx } = host;
  const list = taskActors(ctx, g, t.id),
    apps = taskApps(ctx, g, t.id),
    more = Math.max(0, list.length - 3);
  return (
    <span className="t-faces">
      {list.slice(0, 3).map((a) => {
        const src = host.avatarSrc(a.avatar);
        return src ? (
          <img
            key={a.channel}
            className="t-face"
            src={src}
            alt=""
            title={`${actorTitle(a)} · ${statusOf(ctx, a)[1]}`}
            draggable="false"
          />
        ) : (
          <span key={a.channel} className="t-face none" title={actorTitle(a)}>
            <Html node={host.harnessLogo(a.harness)} />
          </span>
        );
      })}
      {more ? <span className="t-more">{`+${more}`}</span> : null}
      {apps.length ? (
        <span className="t-apps">
          {apps.slice(0, 3).map((o) => (
            <Html key={o.id} node={host.appMark(o)} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** "+" on a task's card: an agent or an app added to it, from its menu. */
function AddAct({ host, g, k, label }: { host: CardHost; g: Gatherer; k: string; label: string }) {
  const add = host.adds(g, k, label);
  if (!add) return null;
  return (
    <RowButton
      className="task-add"
      title={add.title}
      aria-label="Add to this task"
      data-pop={add.key}
      aria-haspopup="menu"
      aria-expanded="false"
      run={(b) => host.openAdd(g, k, label, b)}
    >
      <span className="task-add-in" aria-hidden="true">
        +<span className="t-lbl">{label}</span>
      </span>
    </RowButton>
  );
}

const takeOutButton = (host: CardHost, title: string, run: () => void) => (
  <button
    className="act take-out"
    type="button"
    title="Take it out of the task"
    aria-label={title}
    onClick={(ev) => {
      ev.stopPropagation();
      run();
    }}
  >
    <Html node={host.icon("takeOut", 13)} />
  </button>
);

/** A task's card: its name, its gatherer and what it holds, "+" and its pencil (its name box under them while it is
 * named), then its items -- its actors, the lead first, each shown by a click; its apps, each selected by one -- each
 * with its own bookmark or close and a mark taking it out of the task; its apps' notifications. */
export function TaskCard({ host, g, t, edit }: { host: CardHost; g: Gatherer; t: Task; edit: CardEdit | null }) {
  const { ctx } = host;
  const rank = (a: Actor) => LEAD_RANK[groupOf(ctx, g, a)] ?? 9;
  const all = taskMembers(ctx, g, t.id).sort((x, y) => rank(x) - rank(y) || (y.last || 0) - (x.last || 0));
  const lead = taskLead(ctx, g, t.id),
    apps = taskApps(ctx, g, t.id);
  const first = lead ? lead.channel : apps.length ? appItem(apps[0].id) : null;
  const what = [all.length ? plural(all.length, "actor") : null, apps.length ? plural(apps.length, "app") : null]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <div className="c-who">
        <TaskFaces host={host} g={g} t={t} />
        <div className="tx">
          <div className="c-nm">{taskName(ctx, g, t)}</div>
          <div className="c-sub">{`${titleOf(ctx, g)} · ${what || "nothing"}`}</div>
        </div>
      </div>
      {host.snapshot ? null : (
        <div className="c-acts">
          {first ? <AddAct host={host} g={g} k={first} label="Add an agent or an app" /> : null}
          <CardAct
            cls="rename"
            title={`${t.name ? "Rename" : "Name"} the task`}
            icon={<Html node={host.icon("pencil", 13)} />}
            run={() => host.editIn({ g: g.name, item: `task:${t.id}` })}
          />
        </div>
      )}
      {!host.snapshot && edit ? <EditBox host={host} e={edit} gname={g.name} /> : null}
      <div className="c-tree">
        {all.map((a) => {
          const [cls, label] = statusOf(ctx, a),
            how = closeHow(ctx, a);
          return (
            <div key={a.channel} className="c-task-row">
              <button
                className="c-row"
                type="button"
                title={`Show it · ${host.besideKey}+click to open side by side`}
                onClick={(ev) => {
                  host.cardHide();
                  host.pick(g.name, a.channel, ev);
                }}
              >
                <Face host={host} a={a} />
                <span className="nm">{actorTitle(a)}</span>
                <RowStatus cls={cls} label={label} />
              </button>
              {/* its own bookmark and close, as its row's; then out of the task (its own mark: not a close) */}
              {actorSave(host, g, a, !!savedAs(ctx, g.name, a))}
              {how
                ? closeButton(
                    host,
                    how === "close" ? "Close this session, even mid-turn" : "Never started · remove it from the list",
                    "Close session",
                    () => host.closeActor(g, a, how),
                  )
                : null}
              {takeOutButton(host, `Take ${actorTitle(a)} out of the task`, () => host.takeOut(g.name, a.channel))}
            </div>
          );
        })}
        {apps.map((o) => (
          <div key={o.id} className="c-task-row c-app-row" data-instance={o.id}>
            <button
              className="c-row"
              type="button"
              title={`Show ${o.app.label} · right-click to move or close its panel`}
              onClick={(ev) => {
                host.cardHide(ev);
                host.selectApp(g.name, o, ev);
              }}
              // its panel's menu opened: the card put away, as a click puts it away
              onContextMenu={(ev) => {
                host.appPanelMenu(g.name, o, ev);
                if (ev.defaultPrevented) host.cardHide(ev);
              }}
            >
              <Html node={host.appMark(o)} />
              <span className="nm">{o.name || o.app.label}</span>
              <span className="st">{o.title || ""}</span>
            </button>
            {host.snapshot
              ? null
              : closeButton(host, `Close ${o.app.label}`, `Close ${o.app.label}`, () => host.closeApp(g.name, o))}
            {takeOutButton(host, `Take ${o.app.label} out of the task`, () => host.takeOut(g.name, appItem(o.id)))}
          </div>
        ))}
      </div>
      {apps.map((o) => (
        <Notices key={o.id} host={host} g={g} o={o} named={apps.length > 1} />
      ))}
      <TabLine host={host} k={key(g.name, taskId(t.id))} />
      <div className="c-hint">
        Drag an actor or app onto the task to add it · double-click its name in the list to rename it
      </div>
    </>
  );
}

/** An app's card (an app in no task): what it is and shows -- the user's name for it over them -- its pencil and its ×,
 * its notifications. */
export function AppCard({ host, g, o, edit }: { host: CardHost; g: Gatherer; o: AppItem; edit: CardEdit | null }) {
  const { ctx } = host;
  const t = appTaskOf(ctx, g.name, o.id);
  const notices = appNotices(ctx, g.name, o.id);
  return (
    <>
      <div className="c-who">
        <Html node={host.appFace(o)} />
        <div className="tx">
          <div className="c-nm">{appShown(o)}</div>
          <div className="c-sub">
            {[titleOf(ctx, g), o.app.label, o.name ? o.title : null, o.folder].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
      {host.snapshot ? null : (
        <div className="c-acts">
          <CardAct
            cls="rename"
            title={`${o.name ? "Rename" : "Name"} ${o.app.label}`}
            icon={<Html node={host.icon("pencil", 13)} />}
            run={() => host.editIn({ g: g.name, item: appItem(o.id) })}
          />
          <CardAct
            cls="close"
            title={`Close ${o.app.label}`}
            icon={<Html node={host.closeIcon()} />}
            run={() => {
              host.cardHide();
              host.closeApp(g.name, o);
            }}
          />
        </div>
      )}
      {!host.snapshot && edit ? <EditBox host={host} e={edit} gname={g.name} /> : null}
      {notices.length ? <Notices host={host} g={g} o={o} /> : <div className="c-st">No notifications</div>}
      <TabLine host={host} k={key(g.name, t === null ? appItem(o.id) : taskId(t))} />
      <div className="c-hint">Drag it onto an actor or task to add it there · double-click its name to rename it</div>
    </>
  );
}

/** An app's notifications: the newest first (five), each opening the app where it says by a click, dismissed by its ×
 * -- those the reader has not seen marked. `named`: the app's name over them (a task's card, with apps of more than
 * one). */
const NOTICES_SHOWN = 5;
function Notices({ host, g, o, named = false }: { host: CardHost; g: Gatherer; o: AppItem; named?: boolean }) {
  const list = appNotices(host.ctx, g.name, o.id) as Notice[];
  if (!list.length) return null;
  const since = host.ctx.seenAt[appKey(g.name, o.id)] || 0;
  return (
    <div className="c-notices" role="list" aria-label={`${o.app.label}'s notifications`}>
      {named ? <div className="c-nhead">{appTitle(o)}</div> : null}
      {list.slice(0, NOTICES_SHOWN).map((n, i) => (
        <div key={n.id || i} className={"c-notice" + ((n.at || 0) > since ? " new" : "")} role="listitem">
          <button
            className="c-row"
            type="button"
            title={`Open in ${o.app.label}`}
            onClick={(ev) => {
              host.cardHide(ev);
              host.openNotice(g.name, o.id, n);
            }}
          >
            <span className="status notified">
              <i aria-hidden="true" />
            </span>
            <span className="nm">
              <b>{n.title}</b>
              {n.text ? <span className="nt">{n.text}</span> : null}
            </span>
            <span className="st" data-ago={n.at || undefined}>
              {n.at ? host.ago(n.at) : ""}
            </span>
          </button>
          <button
            className="act take-out"
            type="button"
            title="Dismiss"
            aria-label={`Dismiss ${n.title}`}
            onClick={(ev) => {
              ev.stopPropagation();
              host.dismissNotice(g.name, o.id, n);
            }}
          >
            <Html node={host.closeIcon()} />
          </button>
        </div>
      ))}
      {list.length > NOTICES_SHOWN ? <div className="c-st">{`and ${list.length - NOTICES_SHOWN} more`}</div> : null}
    </div>
  );
}
