// A turn: the user's message, at the right, and under it the agent's -- its last message whole (a click folds it to its
// first line), the ones before it, what it said on the way and its thinking, each folded to a line, the latest few shown
// and the earlier behind a + (a − folds them again); its latest call while nothing followed it; the line under it while
// it runs, or how it stopped; what waits to reach the agent. A button at its message, or ⌘+click on it, shows its files
// and commands at the left. Before the latest, its replies are shown or folded as the setting "Chat's earlier turns" has
// them, a click on its message the other way.
import type { MouseEvent } from "react";
import { plural } from "../../core/format";
import { StrokeIcon } from "../../core/ui/Icon";
import { bashOutput, Bubble, SentBubble } from "./Bubble";
import { useChat } from "./context";
import { Pending, seenKey, useGrowing, waiting } from "./Pending";
import { keepTurn } from "./pull";
import { drawn, LastCall, Reply } from "./Reply";
import { foldsOf } from "./store";
import type { Reply as ReplyData, Stopped, Turn as TurnData } from "./types";
import { pickedOf, turnsOf } from "./view";
import { Done, Finished, Status, StoppedLine, Working } from "./Working";

/** The earlier messages shown before the latest of a turn's; more fold behind its +. */
const MINOR_SHOWN = 2;

/** Where a turn is in the conversation, as the turn list reads it for each. */
export interface TurnPlace {
  /** the latest turn, at work, and nothing opened after it */
  live: boolean;
  /** the latest turn, over, and the actor idle, finished or closed */
  done: boolean;
  /** the turns before this one fold, as the setting "Messages only" has them */
  folds: number;
  /** the session has opened turns since that ag has not stored: drawn after the turns */
  opened: boolean;
  /** when the turn at work began: when its message was sent (the view's `began`) */
  began: number | undefined;
  /** what the line under it says the actor does now */
  now: string;
  /** its calls failing, retried: since when (the view's) */
  failing: { at: number } | null;
  /** how it stopped short: its own, or -- the latest -- as the view has it before the harness's record says */
  stopped: Stopped | null;
}

export function Turn({ t, place }: { t: TurnData; place: TurnPlace }) {
  const { feed, host, folds } = useChat();
  const turns = turnsOf(feed),
    last = turns.length - 1,
    latest = t.n === last;
  const { live, done } = place;
  const on = t.n === pickedOf(feed, turns);
  const info = feed.info;
  // its messages, by their place in the turn (their ids keep it)
  const said: [ReplyData, number][] = (t.replies || [])
    .map((r, i): [ReplyData, number] => [r, i])
    .filter(([r]) => drawn(r));
  const lastText = said.map(([r]) => r.kind).lastIndexOf("text");
  const before = lastText < 0 ? said : said.slice(0, lastText),
    after = lastText < 0 ? [] : said.slice(lastText + 1);
  const extra = before.length <= MINOR_SHOWN + 1 ? 0 : before.length - MINOR_SHOWN; // behind the +, or under the −
  const hidden = folds.opened.has(t.n) ? 0 : extra;
  const from = live ? (place.began ?? null) : null; // when it began: its message sent
  // before the latest, its replies shown or folded -- folded at first under "Messages only" those before `folds`, shown
  // under "Whole"; a click on its message the other way, kept so as the turns move on (flips), until a click puts it back
  const earlier = !latest,
    atFirst = !earlier || t.n >= place.folds || feed.earlierTurns === "whole";
  const whole = folds.flips.has(t.n) ? folds.flips.get(t.n)! : atFirst;
  const folded = useChat().sideFolded;
  const showing = on && !folded;
  const flip = () => keepTurn(feed.key, t.n, () => foldsOf(feed.key).getState().flip(t.n, whole, atFirst));
  // its files and commands at the left (the turn picked; folded away when they already show)
  const side = () =>
    keepTurn(feed.key, t.n, () => {
      if (showing) return host.foldSide(feed.key, true);
      if (folded) host.foldSide(feed.key, false);
      if (!on) return host.setFilesTurn(feed.key, t.n);
    });
  const sideTip = showing ? "Fold this turn's files and commands" : "Show this turn's files and commands";
  const foldTip = whole ? "Fold this turn to your message" : "Show this turn's replies";
  // the user's message: a click on it before the latest shows or folds the turn's replies (the first message's chevron
  // says which); ⌘+click (Ctrl+click) shows or folds its files and commands at the left, as its button does
  const click = (ev: MouseEvent) => (ev.metaKey || ev.ctrlKey ? side() : earlier ? flip() : null);
  const sideClick = `${host.beside}+click: ${sideTip[0].toLowerCase()}${sideTip.slice(1)}`;
  const titled = (title: string | null) =>
    !earlier ? (title ? title + ". " : "") + sideClick : `${title ? title + ". " : ""}${foldTip}. ${sideClick}`;
  // at the first message's end, how much the turn holds: what the agent said and thought (as shown under it), and its
  // calls (files.py's `calls`, as its commands at the left list them)
  const held = said.length + (t.calls || 0);
  // what waits to reach the agent: at the latest turn's end, unless the session opened a turn since (drawn there)
  const waits = latest && !place.opened ? waiting(feed) : null;
  // the latest, drawn in the place of the turn opening it was a moment ago: growing in on from where that one was
  const grow = useGrowing(latest ? seenKey(feed, t.cid, t.text) : "");
  return (
    <>
      <div
        className={
          "fl-turn" +
          (on ? " on" : "") +
          (whole ? "" : " folded") +
          (whole && !atFirst ? " shown" : "") +
          (grow ? " fl-in" : "")
        }
        style={grow ?? undefined}
        id={`fl-turn-${t.n}`}
      >
        <div className="fl-head">
          <Bubble
            text={t.text}
            kind={t.kind}
            title={titled(null)}
            button={earlier}
            expanded={whole}
            onClick={click}
            wrap={bashOutput(t)}
            end={
              <>
                {held ? (
                  <span
                    className="fl-count"
                    title={`${plural(said.length, "message")} from the agent, ${plural(t.calls || 0, "command")}`}
                  >
                    {plural(held, "message")}
                  </span>
                ) : null}
                {earlier ? (
                  <span className="fold-mark" aria-hidden="true">
                    <StrokeIcon d={host.icons.chevron} size={14} />
                  </span>
                ) : null}
              </>
            }
          />
          <span className="fl-btns">
            <button
              type="button"
              className="fl-side-btn"
              aria-pressed={showing ? "true" : "false"}
              title={sideTip}
              aria-label={sideTip}
              onClick={side}
            >
              <StrokeIcon d={host.icons.sidebar} size={14} />
            </button>
          </span>
        </div>
        {(t.more || []).map((m, i) => (
          <Bubble
            key={i}
            text={m.text}
            kind={m.kind}
            joined
            title={titled("Sent while the agent was working")}
            button={earlier}
            expanded={whole}
            onClick={click}
          />
        ))}
        {!whole ? null : (
          <>
            {before.length ? (
              <div className="fl-minor">
                {extra ? (
                  <button
                    type="button"
                    className="fl-more"
                    aria-expanded={hidden ? "false" : "true"}
                    title={hidden ? "Show all earlier messages" : "Fold earlier messages"}
                    onClick={() => foldsOf(feed.key).getState().toggleOpened(t.n)}
                  >
                    <span className="sg" aria-hidden="true">
                      {hidden ? "+" : "−"}
                    </span>
                    {plural(extra, "earlier message")}
                  </button>
                ) : null}
                {before.slice(hidden).map(([r, i]) => (
                  <Reply key={`r${i}`} r={r} i={i} n={t.n} />
                ))}
              </div>
            ) : null}
            {(t.sent || []).map((m, i) => (
              <SentBubble key={i} m={m} />
            ))}
            {lastText < 0 ? null : (
              <Reply key={`m${said[lastText][1]}`} r={said[lastText][0]} i={said[lastText][1]} n={t.n} main />
            )}
            {after.length ? (
              <div className="fl-minor">
                {after.map(([r, i]) => (
                  <Reply key={`r${i}`} r={r} i={i} n={t.n} />
                ))}
              </div>
            ) : null}
            {t.last ? (
              <div className="fl-minor">
                <LastCall t={t} live={live} />
              </div>
            ) : null}
            {live ? (
              <Working
                last={place.failing ? place.failing.at : Math.max(info.last || 0, from || 0) || null}
                at={from}
                now={place.now}
                retrying={!!place.failing}
              />
            ) : (
              <StoppedLine
                t={place.stopped === (t.stopped ?? null) ? t : { ...t, stopped: place.stopped }}
                latest={latest}
              />
            )}
            {done ? <Finished t={t} /> : null}
            {waits ? <Pending w={waits} /> : null}
          </>
        )}
      </div>
      {/* under the latest turn's box: the actor at work; or, its turn over, the actor done */}
      {live ? <Status work={t.work} now={place.now} /> : done ? <Done t={t} /> : null}
    </>
  );
}
