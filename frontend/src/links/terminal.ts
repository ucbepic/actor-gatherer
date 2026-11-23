// What the terminal (features/terminal/, TypeScript) takes from the page around it and from the other features: what a
// session's terminal asks of the page (term.ts's TermHost), and what its view and a shell's pane need (link.ts's
// TermPage). Filled here, at the app's level, before any module starts (src/page.js's linkTerminal).
import { readOnlyWhy } from "../features/chat/chat";
import { addChatView } from "../features/chat/views";
import { closeShell, firstAgent, isHidden } from "../features/list/list";
import { select } from "../features/list/modes";
import type { Gatherer } from "../features/list/types";
import { setTermPage, type TermGroup, type TermPage, type TermPane } from "../features/terminal/link";
import { shownGone } from "../features/terminal/shell";
import { setTermHost } from "../features/terminal/term";
import * as state from "../core/page/state";
import * as helpers from "../core/page/helpers";
import type { Home } from "../core/api/types";
import type { Pane, PageActor } from "../core/page/types";
import * as data from "../features/page/data";
import * as paneView from "../features/page/pane-view";
import * as settings from "../features/settings/panel";
import * as layout from "../features/layout/panes";

// The page's own types are its reading of the same panes, groups and actors: handed over as the terminal's.
const asPane = (p: TermPane) => p as unknown as Pane;
const asGroup = (g: TermGroup) => g as unknown as Gatherer;

export function linkTerminal(): void {
  // each terminal's session, as the pane showing it has it
  setTermHost({
    info: (sid) => paneView.paneInfo(paneView.paneWith(sid)),
    gatherer: (sid) => paneView.paneWith(sid)?.g || null,
    home: () => state.state.home as Home | null,
    refresh: () => data.refresh(),
    linkClicked: (uri, ev, sid) => layout.linkClicked(uri, ev, false, paneView.paneWith(sid)),
    shellGone: shownGone,
    here: () => (state.state.selected ? state.state.selected[1] : null),
  });
  setTermPage({
    snapshot: !!state.SNAPSHOT,
    icons: helpers.ICONS,
    home: () => state.state.home as ReturnType<TermPage["home"]>,
    addView: (view) => addChatView(view),
    hasChat: (a) => helpers.hasChat(a as PageActor),
    readOnlyWhy: () => readOnlyWhy(),
    others: () => state.panes.others,
    closePane: (p) => layout.closePane(asPane(p)),
    closeHere: () => layout.closeHere(),
    selected: () => state.state.selected,
    clearSelected: () => {
      state.state.selected = null;
    },
    shownGroups: () =>
      state.state.home
        ? (state.state.home.gatherers as TermGroup[]).filter((g) => g.agents.length && !isHidden(asGroup(g)))
        : [],
    firstAgent: (g) => firstAgent(asGroup(g)),
    select: (g, c) => select(g, c),
    savePanes: () => layout.savePanes(),
    connect: () => settings.connect(),
    render: (now) => data.render(now),
    closeShell: (id) => closeShell({ id } as Parameters<typeof closeShell>[0]),
  });
}
