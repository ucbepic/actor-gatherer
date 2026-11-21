// What the Notes app's panel (ag_apps/notes/panel/) uses of ProseMirror: its document model, the editor's state and
// view, and the commands it takes as they are (marks toggled). Bundled by build.mjs into
// ag_apps/notes/panel/vendor/prosemirror.js, an ES module the panel's modules import.
export { DOMParser, Fragment, Mark, Node, Schema, Slice } from "prosemirror-model";
export { AllSelection, EditorState, NodeSelection, Plugin, PluginKey, Selection, SelectionRange, TextSelection,
  Transaction } from "prosemirror-state";
export { EditorView } from "prosemirror-view";
export { toggleMark } from "prosemirror-commands";
