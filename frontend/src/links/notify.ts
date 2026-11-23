// The notifications (features/notify/) linked to the page around them: the list's actors, apps and what the reader has
// seen, the panes, the apps' host, the page's live state -- link.ts says what they take, checked here against each
// module. Called once by src/main.ts before any module starts.
import { setNotifyLink } from "../features/notify/link";
import { setLive } from "../features/page/data";
import { markSeen, seen, statusOf } from "../features/list/seen";
import { readApps } from "../features/list/apps";
import { appFace, plainFace } from "../features/list/faces";
import { actorTitle, appInfo, appTitle, renderAgents, selectApp, titleOf } from "../features/list/list";
import { cardDraw, hover } from "../features/list/modes";
import * as appHost from "../features/apps/host";
import * as panes from "../features/layout/panes";

// The list's own types are its reading of the same home and apps: handed over as the notifications'.
type ListActor = Parameters<typeof statusOf>[0];
type ListGatherer = Parameters<typeof titleOf>[0];
type ListApp = Parameters<typeof appFace>[0];

/** The notifications handed what they take of the page around them. */
export function linkNotify(): void {
  setNotifyLink({
    setLive,
    status: (a) => statusOf(a as unknown as ListActor)[0],
    seenAt: () => seen.at,
    markSeen,
    plainFace: (a) => plainFace(a as unknown as ListActor),
    appFace: (o) => appFace(o as ListApp),
    appInfo: (gname, id) => appInfo(gname, id),
    appTitle: (o) => appTitle(o as ListApp),
    titleOf: (g) => titleOf(g as unknown as ListGatherer),
    actorTitle: (a) => actorTitle(a as unknown as ListActor),
    named: (name) => appHost.named(name),
    readApps,
    selectApp: (gname, o) => selectApp(gname, o as ListApp, {} as Parameters<typeof selectApp>[2]),
    listChanged: () => {
      renderAgents();
      if (hover.shown) cardDraw();
    },
    openActors: () => panes.openActors(),
    isAt: (sel, g, c) => panes.isAt(sel, g, c),
    pick: (g, c) => panes.pick(g, c, {}),
    paneNote: (text) => panes.paneNote(text),
  });
}
