"""The host's files shared live, as an app whose manifest asks `docs` is given them (Host.docs(); DESIGN.md, "The
host's shared files"): each file open is one document (a CRDT's, Yjs's) that every page editing it holds a copy of,
the file on disk one more of its editors -- what an actor or anything else writes to it merged in as it lands, three
ways, around what the pages typed and did not save; the lines the pages edited since the file was opened (its conflict
zone) asked about, not merged into. The actors working on branches of their own have their changes merged into the
same documents (held for the user where they say so), and what an actor changed of a file lately can be read. One
copy of each, whichever app shows it: two apps (or two pages) with a file open edit the same document.

Only an app run in the host's own process is given it (an app in its own process: AppError), and only one whose
manifest asks it (`[capabilities] docs = true`). Paths are absolute, each under the `root` it is asked with (the
folder a panel shows): one outside it is refused. Every method raises AppError for what it refuses: the file is not
text, is too large, has changed meanwhile, ...

    the folders     listing(dir, root), about(path, root), create(path, root, folder), files(dir, root),
                    resolve(path, root)
    a file open     open(path, root, conn, client, hold) -> Joined; edit, aware, save, settle, clear_zone, hold, state
    an actor's      view(path, root, channel) -> text; put(path, root, seen, wanted, by, how): an actor's change put
    change          into the open file -- "live", at once (written to the file too), what meets the lines the pages
                    are editing held for them; or "propose", each change held for them to accept or reject (accepted,
                    written to the file) -- `view` then the text with that actor's proposals in
    actors          branches(root), approve(session, on), decide(session, path, take);
                    changes(gatherer, channel, path, since, cwd); writers(dirs, since)

What a stream of an open file sends (Joined.take), each (name, value):

    init     {epoch, update (the document, a Yjs update, base64), sv (its state vector), aware (the other pages'
             cursors, y-protocols awareness updates, base64)}: first, and again once the stream is taken up again
    update   {update, disk}: another page's edit, or (disk) the file's own change on disk, merged in
    aware    {update}: another page's cursor
    left     {client}: a page gone
    state    the file's state, after each edit, any page's and the disk's: {dirty, missing, error, changed, saved,
             pages, now, hold, asking, conflicts: [{id, from, to (UTF-16), base, theirs, at, since, zone, asked, agent}],
             zone: [[from, to]...], marks: [{from, to, gatherer, channel}]} -- a conflict's `agent`: an actor's change
             held (a branch's: with `branch`; one put in: `put`, and `why` -- "approve", a proposal; "zone", lines the
             pages are editing); `asked`: the file's change, asked about as a page holds it "ask"
    failed   {error}: it could not be opened
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple


@dataclass
class Joined:
    """A page's hold on an open file: `take(wait)` the events for it, within `wait` seconds ([] none yet, None: the
    end -- another stream of the same page took its place), as Response.stream takes them; `close()` once it is over,
    the page gone (its cursor removed from the others')."""
    take: Callable[[float], Optional[List[Tuple[str, Any]]]]
    close: Callable[[], None]


class Docs(ABC):
    """The host's files shared live (module doc)."""

    @property
    @abstractmethod
    def available(self) -> bool:
        """Whether files can be opened for editing here at all (the host has what it needs: pycrdt)."""

    # -- the folders

    @abstractmethod
    def listing(self, directory: str, root: str, since: Optional[float] = None) -> dict:
        """The folder's entries: {dir, entries: [{name, dir, size, mtime, pages (open in how many), dirty, conflicts,
        pending (an actor's branch's changes waiting), proposed (actors' proposals waiting, open or not), writers:
        [{gatherer, channel, at, how}], waiting (the actors whose changes to it wait for the reader: their branch's, a
        proposal, a conflict): [{gatherer, channel}]}], more},
        ... `since`: the writers since then (seconds; none: the last half hour)."""

    @abstractmethod
    def about(self, path: str, root: str) -> dict:
        """What the file is: {path, real (links followed), name, kind (text, image, pdf, audio, video, other), type
        (its media type), size, mtime, text (whether it opens to edit)}."""

    @abstractmethod
    def create(self, path: str, root: str, folder: bool = False) -> dict:
        """A new empty file -- or folder -- the folders above it made too: {path, dir}; refused where anything is."""

    @abstractmethod
    def files(self, directory: str, root: str) -> dict:
        """The files under the folder, as paths from it (git's list in a git project): {dir, files, more, git}."""

    @abstractmethod
    def resolve(self, path: str, root: str) -> str:
        """The path with its links followed, refused unless it is under `root`."""

    # -- a file open

    @abstractmethod
    def open(self, path: str, root: str, conn: str, client: int, hold: str = "zone") -> Joined:
        """The file opened by a page (`conn`: its id, `client`: its document's Yjs client id): its events (module
        doc). The same page opening it again takes the place of its stream before. `hold`: how it takes the file's
        changes on disk -- "zone" (merged in, but for the lines the pages are editing: the conflict zone), "ask" (each one
        asked about) or "never" (each merged in, the zone too)."""

    @abstractmethod
    def hold(self, path: str, root: str, conn: str, how: str) -> dict:
        """How the page takes the file's changes on disk from now ("zone", "ask" or "never", as `open`'s) -> its
        state: the file's taken as the strictest of its pages' holds."""

    @abstractmethod
    def state(self, path: str, root: str) -> dict:
        """The open file's state, as its streams send it (module doc)."""

    @abstractmethod
    def view(self, path: str, root: str, channel: Optional[str] = None) -> str:
        """The file's text, as the pages have it -- with the proposals of the actor `channel` in, each in place of its
        lines. A file no page has open is opened for it (and closed again as one its last page left)."""

    @abstractmethod
    def put(self, path: str, root: str, seen: str, wanted: str, by: Dict[str, Any], how: str) -> dict:
        """An actor's change to the open file: `wanted`, the whole text as it wants it, made of `seen` (its `view`:
        with its own proposals in, for "propose") -- merged onto what changed meanwhile, refused where that meets
        it. `by`: who it is ({channel, gatherer, ...}, kept on what is held: a conflict's `agent`). `how`: "live" or
        "propose" (module doc) -> {landed (changes put in), held, proposed (conflict ids), state}. A file no page has
        open is opened for it, and stays open while what it holds waits for a page to settle it."""

    @abstractmethod
    def proposals(self, root: str) -> List[dict]:
        """The files under `root` with an actor's proposals waiting, open by a page or not: [{path, n, whose:
        [{gatherer, channel}]}], by path."""

    @abstractmethod
    def edit(self, path: str, root: str, conn: str, update: bytes) -> dict:
        """A page's edit (a Yjs update) applied, and sent on to the other pages -> the file's state."""

    @abstractmethod
    def aware(self, path: str, root: str, conn: str, update: bytes) -> None:
        """A page's cursor (a y-protocols awareness update), sent on to the others."""

    @abstractmethod
    def save(self, path: str, root: str) -> dict:
        """The document written to the file (its own change on disk taken in first) -> its state."""

    @abstractmethod
    def settle(self, path: str, root: str, conflict: str, take: str, text: Optional[str] = None,
               theirs: Optional[str] = None, mine: Optional[str] = None) -> dict:
        """A conflict settled: take "mine" (the document's lines kept), "theirs" (the file's, or the branch's, put in
        their place), "both", or "edited" (`text`, made of `theirs` against `mine`, refused if either changed since)
        -> the file's state."""

    @abstractmethod
    def clear_zone(self, path: str, root: str) -> dict:
        """The conflict zone cleared: its lines the file's to change, as any other -> the file's state."""

    # -- the actors

    @abstractmethod
    def branches(self, root: str) -> List[dict]:
        """The actors working on branches of their own of the project `root` is in, and what of theirs waits for the
        user: [{session_id, gatherer, channel, branch, project, worktree, approve, held: {path: {kind, n}}}]."""

    @abstractmethod
    def approve(self, session: str, on: bool) -> None:
        """An actor's branch: each of its changes held for the user to accept (on), or merged as it comes."""

    @abstractmethod
    def decide(self, session: str, path: str, take: str) -> None:
        """What an actor's branch holds for a file settled at once: take "theirs" (all of it in) or "mine" (left out)."""

    @abstractmethod
    def changes(self, gatherer: str, channel: str, path: str, since: float, cwd: str = "") -> dict:
        """What the actor changed of the file since `since`: {changes: [{at, via, asked, kinds, changed, error,
        blocks}]} -- each block as the dashboard's Chat shows a file's: {t: "diff", old, new, ...} -- or {error}."""

    @abstractmethod
    def writers(self, directories: List[str], since: float) -> Dict[str, List[dict]]:
        """Who changed each entry of the folders since `since`, as ag's hooks found each tool call did on disk: by
        entry name, [{gatherer, channel, at, how}], the latest first."""
