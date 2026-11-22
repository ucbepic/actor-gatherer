// The Notes panel's page as a ProseMirror document (ag_apps/notes/panel/doc.js): the notebook's blocks to the doc and
// back, a change to the doc as the notebook's ops, the doc made what the notebook says in the fewest steps, and lines
// picked whole. The panel's modules are plain ES modules outside this build: read as the browser reads them.
import { describe, expect, it } from "vitest";

// @ts-expect-error -- a plain module of the panel's, with no types
const d = await import("../../../../ag_apps/notes/panel/doc");
// @ts-expect-error -- the bundle the panel imports (assets/src/notes)
const pm = await import("../../../../ag_apps/notes/panel/vendor/prosemirror");

type Block = { id: string; type: string; text?: string; indent?: number; checked?: boolean };
const line = (id: string, text = "", type = "text", more: Partial<Block> = {}): Block => ({ id, type, text, ...more });
const stateOf = (blocks: Block[]) => pm.EditorState.create({ schema: d.schema, doc: d.docOf(blocks) });
const words = (doc: { forEach: (f: (n: { attrs: { id: string }; textContent: string }) => void) => void }) => {
  const out: string[] = [];
  doc.forEach((n) => out.push(`${n.attrs.id}:${n.textContent}`));
  return out;
};
/** The doc with `text` typed at `at` in the line `id` (a place in its words). */
function typed(blocks: Block[], id: string, at: number, text: string) {
  const s = stateOf(blocks),
    p = d.posOf(s.doc, id);
  return { was: s.doc, now: s.apply(s.tr.insertText(text, p.pos + 1 + at)).doc };
}

describe("a block as a node, and back", () => {
  it("keeps a line's words as the notebook writes them", () => {
    for (const text of [
      "plain words",
      "<b>bold</b> and <i>it</i>, <u>u</u> <s>s</s> <code>x()</code>",
      '<a href="https://example.com/?a=1&amp;b=2">a link</a> after',
      "two<br>lines",
      "a &lt;tag&gt; &amp; spaces&nbsp;kept  twice",
      '<a href="page:abcdef12">Plans</a> linked',
      '<a href="https://x.org"><b>bold</b> link</a>',
    ]) {
      const n = d.nodeOf(line("a1", text));
      expect(d.fieldsOf(n).text).toBe(text);
    }
  });
  it("reads code as its plain text, and atoms with no words", () => {
    expect(d.fieldsOf(d.nodeOf(line("c", "a < b\n  c", "code")))).toEqual({
      id: "c",
      type: "code",
      text: "a < b\n  c",
      indent: 0,
      checked: false,
    });
    expect(d.fieldsOf(d.nodeOf(line("t", "", "table"))).type).toBe("table");
    expect(d.nodeOf(line("t", "", "divider")).isAtom).toBe(true);
  });
  it("keeps a to-do's tick and a list's indent, and no indent where the notebook allows none", () => {
    expect(d.fieldsOf(d.nodeOf(line("x", "milk", "todo", { checked: true, indent: 2 })))).toEqual({
      id: "x",
      type: "todo",
      text: "milk",
      indent: 2,
      checked: true,
    });
    expect(d.fieldsOf(d.nodeOf(line("h", "Head", "h1", { indent: 3 }))).indent).toBe(0);
  });
  it("drops what the notebook doesn't keep: links it refuses, zero-width spaces, a line of line breaks", () => {
    expect(d.fieldsOf(d.nodeOf(line("a", '<a href="javascript:alert(1)">x</a>'))).text).toBe("x");
    expect(d.fieldsOf(d.nodeOf(line("a", "a\u200bb"))).text).toBe("ab");
    expect(d.fieldsOf(d.nodeOf(line("a", "<br><br>"))).text).toBe("");
    expect(d.fieldsOf(d.nodeOf(line("a", "<b></b>x"))).text).toBe("x");
  });
  it("can write every node as HTML, as the browser's clipboard is given a copy", () => {
    for (const t of Object.values(d.schema.nodes) as { name: string; spec: { toDOM?: unknown } }[])
      if (t.name !== "doc" && t.name !== "text") expect([t.name, typeof t.spec.toDOM]).toEqual([t.name, "function"]);
  });
  it("writes a link to a page with the page's title as it is now", () => {
    const n = d.nodeOf(line("a", 'see <a href="page:abcdef12">Old</a>'));
    expect(d.htmlOf(n.content, (id: string) => (id === "abcdef12" ? "New & better" : null))).toBe(
      'see <a href="page:abcdef12">New &amp; better</a>',
    );
  });
});

describe("a change to the doc, as the notebook's ops", () => {
  const page = "p1";
  it("is a line's words, typed", () => {
    const { was, now } = typed([line("a", "one"), line("b", "two")], "b", 3, "!");
    expect(d.opsOf(was, now, page)).toEqual([{ op: "block.put", page, block: { id: "b", text: "two!" } }]);
  });
  it("is a block new after the one before it, and blocks gone", () => {
    const s = stateOf([line("a", "one"), line("b", "two"), line("c", "three")]);
    const at = d.posOf(s.doc, "b");
    const tr = s.tr
      .delete(d.posOf(s.doc, "c").pos, s.doc.content.size)
      .insert(at.pos, d.nodeOf(line("n", "new", "todo")));
    expect(d.opsOf(s.doc, tr.doc, page)).toEqual([
      { op: "block.delete", page, block: "c" },
      { op: "block.put", page, block: { id: "n", type: "todo", text: "new", indent: 0, checked: false }, after: "a" },
    ]);
  });
  it("moves the fewest blocks", () => {
    const blocks = ["a", "b", "c", "d"].map((id) => line(id, id));
    const was = d.docOf(blocks),
      now = d.docOf([blocks[1], blocks[2], blocks[3], blocks[0]]);
    expect(d.opsOf(was, now, page)).toEqual([{ op: "block.move", page, block: "a", after: "d" }]);
  });
  it("puts all of a block turned into another type, and only the field changed otherwise", () => {
    const was = d.docOf([line("a", "x", "text", { indent: 1 })]);
    expect(d.opsOf(was, d.docOf([line("a", "x", "todo", { indent: 1 })]), page)).toEqual([
      { op: "block.put", page, block: { id: "a", type: "todo", text: "x", indent: 1, checked: false } },
    ]);
    expect(d.opsOf(was, d.docOf([line("a", "x", "text", { indent: 2 })]), page)).toEqual([
      { op: "block.put", page, block: { id: "a", indent: 2 } },
    ]);
  });
  it("is nothing for the same doc", () => {
    const doc = d.docOf([line("a", "<b>x</b>")]);
    expect(d.opsOf(doc, d.docOf([line("a", "<b>x</b>")]), page)).toEqual([]);
  });
});

describe("the doc made what the notebook says", () => {
  it("changes only what differs, the caret mapped through another's words", () => {
    const s0 = stateOf([line("a", "hello"), line("b", "world")]);
    const at = d.posOf(s0.doc, "b").pos + 1 + 3; // in "wor|ld"
    const s = s0.apply(s0.tr.setSelection(pm.TextSelection.create(s0.doc, at)));
    const tr = d.syncTr(s, d.docOf([line("a", "hello there"), line("b", "world")]).content.content);
    expect(words(tr.doc)).toEqual(["a:hello there", "b:world"]);
    expect(tr.selection.head).toBe(at + " there".length);
    expect(tr.steps.length).toBe(1);
  });
  it("adds, deletes and moves blocks, keeping the longest run in order", () => {
    const s = stateOf(["a", "b", "c", "d"].map((id) => line(id, id)));
    const want = d.docOf([line("d", "d"), line("a", "a"), line("x", "x"), line("c", "c!")]).content.content;
    const tr = d.syncTr(s, want);
    expect(words(tr.doc)).toEqual(["d:d", "a:a", "x:x", "c:c!"]);
    const again = d.syncTr(s.apply(tr), want);
    expect(again.docChanged).toBe(false);
  });
  it("turns a line into another type in place, and code into words by replacing it", () => {
    const s = stateOf([line("a", "<b>x</b>"), line("c", "y", "code")]);
    const tr = d.syncTr(s, d.docOf([line("a", "<b>x</b>", "todo", { checked: true }), line("c", "y")]).content.content);
    expect(tr.doc.child(0).type.name).toBe("todo");
    expect(tr.doc.child(0).attrs.checked).toBe(true);
    expect(tr.doc.child(1).type.name).toBe("line");
    expect(d.typeOf(tr.doc.child(1))).toBe("text");
  });
});

describe("the caret, by line", () => {
  it("is found again in another doc by its line's id and place", () => {
    const s0 = stateOf([line("a", "one"), line("b", "two")]);
    const at = d.posOf(s0.doc, "b").pos + 2;
    const kept = d.selectionAt(pm.TextSelection.create(s0.doc, at));
    expect(kept).toEqual({ anchor: "b", at: 1, head: "b", to: 1 });
    const other = d.docOf([line("b", "two"), line("a", "one")]);
    expect(d.selectionIn(other, kept).head).toBe(2);
    expect(d.selectionIn(d.docOf([line("a", "one")]), kept)).toBe(null);
  });
  it("puts a plain-text place in a line's node, after a link to a page", () => {
    const n = d.nodeOf(line("a", 'ab<a href="page:abcdef12">Page</a>c<br>d'));
    expect(d.offsetOfPlain(n, 1)).toBe(1);
    expect(d.offsetOfPlain(n, 3)).toBe(3); // in the link's title: after the link
    expect(d.offsetOfPlain(n, 7)).toBe(4);
    expect(d.offsetOfPlain(n, 99)).toBe(n.content.size);
  });
  it("finds the longest run in order", () => {
    expect([...d.kept([0, 3, 1, 2])].sort()).toEqual([0, 2, 3]);
    expect([...d.kept([])]).toEqual([]);
  });
});

describe("lines picked", () => {
  const blocks = ["a", "b", "c", "d"].map((id) => line(id, id));
  it("are a run from the anchor's line to the head's, either way", () => {
    const doc = d.docOf(blocks);
    const down = d.LinesSelection.create(doc, "b", "c"),
      up = d.LinesSelection.create(doc, "c", "b");
    expect(down.ids).toEqual(["b", "c"]);
    expect(up.ids).toEqual(["b", "c"]);
    expect([up.anchorId, up.headId]).toEqual(["c", "b"]);
    expect(down.empty).toBe(false);
  });
  it("map through a line deleted from among them", () => {
    const s = stateOf(blocks);
    const sel = d.LinesSelection.create(s.doc, "a", "c");
    const b = d.posOf(s.doc, "b");
    const tr = s.apply(s.tr.setSelection(sel)).tr.delete(b.pos, b.pos + b.node.nodeSize);
    expect(tr.selection.ids).toEqual(["a", "c"]);
  });
});
