// The Chat view's frame, for the actor given (its key, the feed's): the conversation at the right, each turn's files and
// commands at the left (side/), the file picked between them; before the first turn is stored, the actor waving hello;
// before the files and the stream's view of the conversation have come, "Loading…". What the agent waits on the user
// for, or the call it stopped on, under the conversation (asking/). It draws again by itself when what it shows
// changes -- the stream's view of the conversation (data.ts), the turn's files (files.ts), a fold, the panel -- and as
// the page draws, with what the page hands it (its feed). A frame kept drawn while another actor's is on the page stays
// as it was: the turn list's state (store.ts) is that one's now.
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { queryClient } from "../../core/api/query";
import { Cards } from "./asking/Cards";
import { ChatContext, useChat, type Chat } from "./context";
import { useChatData } from "./data";
import { filesKey, type FilesOf } from "./files";
import { Paths } from "./side/CallView";
import { FileView } from "./side/FileView";
import { cmdCounts, gitOnly, shownFiles, Side, SideBar, type Task } from "./side/Side";
import { NARROW_SIDE, sideFolded, useSide, type SideState } from "./side/store";
import { useOnPage, useTurns } from "./store";
import { Talk } from "./Talk";
import type { ChatFeed, FilesData } from "./types";
import { AT_WORK, currentOf, turnsOf } from "./view";

/** The pane this frame is in, as wide as the panel's room: less the Details panel when it is open beside the
 * conversation (chat.css's .drawer: 55%, at most 760px, in a pane over 930px; narrower, it lies over it). */
function useNarrow(frame: Element, details: boolean, onPage: boolean) {
  useLayoutEffect(() => {
    if (!onPage) return;
    const pane = frame.closest(".pane");
    const measure = () => {
      const w = pane?.clientWidth || innerWidth;
      useSide.getState().setNarrow((details && w > 930 ? w - Math.min(w * 0.55, 760) : w) < NARROW_SIDE);
    };
    measure();
    if (!pane || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(pane);
    return () => watch.disconnect();
  }, [frame, details, onPage]);
}

/** The files of the turn shown, as kept (files.ts): those of its key once they come; the page's until then. */
function useFiles(feed: ChatFeed): FilesData | null {
  const which: FilesOf = {
    gatherer: feed.gatherer,
    channel: feed.key.slice(feed.gatherer.length + 1),
    turn: feed.picked,
    row: feed.picked === null ? null : (turnsOf(feed)[feed.picked]?.row_id ?? null),
    cwd: feed.cwd,
  };
  const kept = useQuery(
    {
      queryKey: filesKey(which),
      queryFn: () => queryClient.getQueryData<FilesData>(filesKey(which)) ?? feed.data!,
      enabled: false, // fetched as files.ts's loadFiles says: this reads what it kept
    },
    queryClient,
  ).data;
  return kept ?? feed.data;
}

export function ChatMain({ frame }: { frame: HTMLElement }) {
  const { feed: drawn, host } = useChat();
  const onPage = useOnPage((s) => s.key === drawn.key);
  // the stream's view as it comes, not only as the page last drew it
  const taken = useChatData((s) => s.views.get(drawn.key));
  const feed: ChatFeed = taken && taken.view !== drawn.view ? { ...drawn, view: taken.view } : drawn;
  const folds = useTurns();
  const side = useSide();
  const d = useFiles(feed);
  useNarrow(frame, feed.details, onPage);
  // the Esc sent is over once the turn it was sent for is (opening, at work or asking: an Esc stops it)
  const cur = currentOf(feed);
  const interrupting = feed.interrupting && !(cur && !AT_WORK.has(cur.state));
  useEffect(() => {
    if (onPage && feed.interrupting && !interrupting) host.interruptOver();
  }, [onPage, feed.interrupting, interrupting, host]);
  return (
    <Frame
      onPage={onPage}
      frame={frame}
      chat={{ feed, host, folds, sideFolded: sideFolded(side) }}
      side={side}
      d={d}
      interrupting={interrupting}
    />
  );
}

interface FrameProps {
  onPage: boolean;
  frame: HTMLElement;
  chat: Chat;
  side: SideState;
  d: FilesData | null;
  interrupting: boolean;
}

/** The frame's content, drawn from what ChatMain read -- not again while another actor's frame is on the page. */
const Frame = memo(FrameView, (_was, now) => !now.onPage);

function FrameView({ chat, side, d, interrupting }: FrameProps) {
  const { feed, host } = chat;
  const talk = useRef<HTMLDivElement>(null);
  const turns = turnsOf({ ...feed, data: d ?? feed.data });
  // drawn once both the files and -- the page's stream live -- its view have come: not the turns first and what they
  // are at a moment later (the actor done under the latest popping in, the conversation moved under the reader)
  const waits = !d || (!feed.view && feed.streaming);
  const hello = !waits && !turns.length && !feed.view?.opening && !feed.mine.length;
  // what the agent waits on the user for, or the call it stopped on: after the conversation, at the right of the grid,
  // else in the frame
  const cards = (
    <Cards
      info={feed.info}
      home={feed.home}
      answerable
      snapshot={feed.snapshot}
      terminalView={feed.terminalView}
      host={host}
    />
  );
  if (waits)
    return (
      <>
        <div className="desc" style={{ padding: "10px 16px" }}>
          {feed.snapshot ? "A snapshot has no files. Run `ag dashboard` live to see them." : "Loading…"}
        </div>
        {cards}
      </>
    );
  const conversation = (
    <ChatContext value={chat}>
      <Talk ref={talk} interrupting={interrupting} />
    </ChatContext>
  );
  if (hello)
    return (
      <>
        {conversation}
        {cards}
      </>
    );
  return (
    <Grid chat={chat} side={side} d={d!}>
      {conversation}
      {cards}
    </Grid>
  );
}

function Grid({ chat, side, d, children }: { chat: Chat; side: SideState; d: FilesData; children: ReactNode }) {
  const { feed, host, folds } = chat;
  const { hiddenKinds, showTmp, showGit } = side;
  const cwd = (feed.info.cwd || "").replace(/\/$/, ""),
    home = (d.home || "").replace(/\/$/, "");
  const sel = d.files.find((f) => f.path === folds.sel && (showGit || !gitOnly(f))) || null;
  const rel = (p: string) =>
    cwd && p.startsWith(cwd + "/")
      ? p.slice(cwd.length + 1)
      : home && (p === home || p.startsWith(home + "/"))
        ? "~" + p.slice(home.length)
        : p;
  const background = (feed.info.background || []) as Task[];
  const pick = (p: string | null) => useTurns.getState().pick(p);
  const panel = chat.sideFolded ? (
    <SideBar
      files={shownFiles(d.files, hiddenKinds, showTmp, showGit).files}
      counts={cmdCounts(d.commands, feed.running)}
      background={background.length}
      hiddenKinds={hiddenKinds}
      icons={host.icons}
      foldSide={(f) => host.foldSide(f)}
      acts={host.barActs()}
    />
  ) : (
    <Side
      actor={feed.key}
      d={d}
      cwd={cwd}
      home={home}
      running={feed.running}
      opening={!turnsOf(feed).length}
      sel={sel}
      folded={folds.dirs}
      side={side}
      background={background}
      harnesses={feed.home?.harness_info || {}}
      icons={host.icons}
      pick={pick}
      fold={(p) => useTurns.getState().foldDir(p)}
      foldSide={(f) => host.foldSide(f)}
    />
  );
  return (
    <Paths value={{ cwd: feed.info.cwd || "", home: d.home || "" }}>
      <div
        className={
          "fl-grid" + (sel ? " open" : "") + (chat.sideFolded ? " folded" : "") + (side.narrow ? " narrow" : "")
        }
      >
        {panel}
        {/* the file view only while a file is picked: the files and the conversation have the page until then */}
        {sel ? (
          <div className="fl-pane" data-keep="files-pane">
            <FileView
              f={sel}
              path={rel(sel.path)}
              id={`fl-${d.turn}-${d.files.indexOf(sel)}`}
              gatherer={feed.gatherer}
              showGit={showGit}
              close={() => pick(null)}
              icons={host.icons}
            />
          </div>
        ) : null}
        <div className="fl-right">{children}</div>
      </div>
    </Paths>
  );
}
