// Markdown as the page draws a message (md.ts's markdown(), which the old page calls): the same HTML in the same boxes
// (.md; a harness's reply block as a .proposed-plan card), a code block folded by a click before drawn folded again.
// Its code blocks' buttons work by the page's one listener (highlight/fence.ts's codeClick, on the document). Its math
// typeset once KaTeX loads (tex.ts): each box drawn again then.
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { foldKept } from "./highlight/fence";
import { markdownHtml, splitReply } from "./md";
import { onTexLoaded, texLoaded } from "./tex";

export interface MarkdownProps {
  text: string;
  /** each line break kept, for text written as lines rather than as markdown (a subagent's report) */
  breaks?: boolean;
}

export function Markdown({ text, breaks = false }: MarkdownProps) {
  // the harnesses' reply blocks are read from the store's home as it is now: they change only with harness_kit
  const reply = splitReply(text);
  if (!reply) return <MarkdownBox text={text} breaks={breaks} />;
  return (
    <div className="md">
      {reply.before ? <Markdown text={reply.before} breaks={breaks} /> : null}
      <div className="proposed-plan">
        <div className="pp-head">{reply.title}</div>
        <Markdown text={reply.inner} breaks={breaks} />
      </div>
      {reply.after ? <Markdown text={reply.after} breaks={breaks} /> : null}
    </div>
  );
}

function MarkdownBox({ text, breaks }: Required<MarkdownProps>) {
  useSyncExternalStore(onTexLoaded, texLoaded); // drawn again once KaTeX loads, its math typeset
  const html = markdownHtml(text, breaks);
  const ref = useRef<HTMLDivElement>(null);
  // Its HTML is set again only when it changes, so a block folded or opened since stays so; when it does change, the
  // blocks folded before are folded again.
  useLayoutEffect(() => {
    if (ref.current) foldKept(ref.current);
  }, [html]);
  if (html === null)
    return (
      <div className="md" style={{ whiteSpace: "pre-wrap" }}>
        {text}
      </div>
    );
  // sanitized by DOMPurify, raw HTML escaped before it (md.ts)
  return <div ref={ref} className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
