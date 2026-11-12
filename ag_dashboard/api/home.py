"""The home -- every gatherer and its actors, as the list shows them -- and what the reader keeps of it: gatherers made,
hidden, named; actors saved, named, seen, and kept in folders."""

import time

import harness_kit
from fastapi import APIRouter
from starlette.responses import Response

from .. import folders, gatherer_folders, groups, hiding, naming, saved, seen, sessions, task_links, tasks, titles
from ..models import Home
from .common import Body, Errors, Parts, answer

router = APIRouter(route_class=Errors)


@router.get("/api/home", response_model=Home)
def the_home(srv: Parts) -> Response:
    """data.home(), each actor with its avatar (avatars.py's `assign`), and the shells open (sessions.py's `shells`):
    read now, a page's first (its stream's after it, shared)."""
    return answer(srv.home_view())


@router.post("/api/gatherers")
def new_gatherer(body: Body) -> Response:
    """{name}: a new gatherer (`ag new`), no session yet -> {name}."""
    return answer(sessions.new_gatherer(str(body.get("name") or "")))


@router.post("/api/hiding")
def hide(srv: Parts, body: Body) -> Response:
    """{gatherer, choice}: keep "hidden" / "shown" / "" for it (hiding.py) -> every choice."""
    kept = hiding.choose(str(body.get("gatherer") or ""), str(body.get("choice") or ""))
    srv.hub.ring(None, what="list")              # every open page's list
    return answer(kept)


@router.post("/api/title")
def title(srv: Parts, body: Body) -> Response:
    """{gatherer, title}: the reader's name for the gatherer ("": none), shown in its place (titles.py) -> every title."""
    kept = titles.give(str(body.get("gatherer") or ""), str(body.get("title") or ""))
    srv.hub.ring(None, what="list")
    return answer(kept)


@router.post("/api/saved")
def save(srv: Parts, body: Body) -> Response:
    """{gatherer, channel, saved}: the actor saved for later, or no longer (saved.py) -> every one saved."""
    kept = saved.choose(str(body.get("gatherer") or ""), str(body.get("channel") or ""), bool(body.get("saved")))
    srv.hub.ring(None, what="list")
    return answer(kept)


@router.post("/api/folders")
def folder(srv: Parts, body: Body) -> Response:
    """{gatherer, do, ...}: the gatherer's folders changed (folders.py) -> {folders: every gatherer's, made?}.

    new {name, parent?} (made: its id), rename {id, to}, move {id, parent?} (a folder put in another; none: at the
    top), delete {id} (what was in it moved up), file {channels, folder?} (actors put in a folder; none: at the top),
    close {id} (every actor in it closed, its bookmark off, its terminals ended, then it marked closed, with the
    folders in it: `left`, the actors in it left open, and `saved`, every one saved after), reopen {id}."""
    g, do = str(body.get("gatherer") or ""), str(body.get("do") or "")
    parent = body.get("parent")
    parent = None if parent in (None, "") else parent
    made, closing = None, {}
    if do == "new":
        made = folders.make(g, str(body.get("name") or ""), parent)
    elif do == "rename":
        folders.rename(g, body.get("id"), str(body.get("to") or ""))
    elif do == "move":
        folders.move(g, body.get("id"), parent)
    elif do == "delete":
        folders.delete(g, body.get("id"))
    elif do == "close":                          # its actors as they are now: the home read afresh
        closing = {"left": folders.close(g, body.get("id"), srv.sessions, srv.home_view()), "saved": saved.stored()}
    elif do == "reopen":
        folders.reopen(g, body.get("id"))
    elif do == "file":
        channels = body.get("channels")
        if not isinstance(channels, list):
            raise ValueError("which actors? `channels`, a list")
        target = body.get("folder")
        folders.file(g, [str(c) for c in channels], None if target in (None, "") else target)
    else:
        raise ValueError("do what? One of new, rename, move, delete, file, close, reopen")
    srv.hub.ring(None, what="list")
    return answer({"folders": folders.stored(), **({"made": made} if made is not None else {}), **closing})


@router.post("/api/groups")
def group(srv: Parts, body: Body) -> Response:
    """{gatherer, to, do, channels?, folder?, into?}: actors, or a folder with every actor in it, moved from one group
    to another (groups.py), in the home's one database -> plan: what it would do, for the page to ask first; move: it
    done -> {moved, folders, tasks}. split {gatherer, folder}: the folder made a group of its own -> {split, ...}."""
    g, to, do = str(body.get("gatherer") or ""), str(body.get("to") or ""), str(body.get("do") or "")
    channels = body.get("channels") or []
    if not isinstance(channels, list):
        raise ValueError("which actors? `channels`, a list")
    folder, into = body.get("folder"), body.get("into")
    folder, into = (None if folder in (None, "") else int(folder)), (None if into in (None, "") else int(into))
    if do == "plan":
        return answer(groups.plan(g, to, [str(c) for c in channels], folder))
    if do == "split":
        if folder is None:
            raise ValueError("which folder?")
        split = groups.split(g, folder)
        srv.hub.ring(None, what="list")
        return answer({"split": split, "folders": folders.stored(), "tasks": tasks.stored(), "titles": titles.stored()})
    if do != "move":
        raise ValueError("do what? plan, move or split")
    moved = groups.move(g, to, [str(c) for c in channels], folder, into)
    srv.hub.ring(None, what="list")
    return answer({"moved": moved, "folders": folders.stored(), "tasks": tasks.stored()})


@router.post("/api/tasks")
def task(srv: Parts, body: Body) -> Response:
    """{gatherer, do, ...}: the gatherer's tasks changed (tasks.py) -> {tasks: every gatherer's, now, task?, attached?}. An
    item is an actor, by its channel, or an app's instance, "app:<its id>"; attachment follows (task_links.py): every
    agent of a task attached to every app of it, one leaving detached from them.

    add {to, items, name?} (the items put in the task the item `to` is in -- in none, one made of them all, called
    `name`, none: named by what is in it -- each agent among them attached to the task's apps before its agent starts, so
    it is given their tools as it starts: `attached`, {channel: [instance ids]}), out {items} (taken out of their
    tasks), rename {id, to} ("": named by what is in it again). `channels` is `items`, as it was called before apps were items."""
    g, do = str(body.get("gatherer") or ""), str(body.get("do") or "")
    items = body.get("items", body.get("channels"))
    if do in ("add", "out") and not isinstance(items, list):
        raise ValueError("which actors or apps? `items`, a list")
    got = {}
    if do == "add":
        new = [str(c) for c in items]
        if any(task_links.coordinator(c) for c in [str(body.get("to") or ""), *new]):
            raise ValueError("a gatherer's own agent is in no task")
        tid, attached = task_links.change(g, lambda: tasks.add(g, str(body.get("to") or ""), new, body.get("name")))
        got = {"task": tid, "attached": attached}
    elif do == "out":
        task_links.change(g, lambda: tasks.take_out(g, [str(c) for c in items]))
    elif do == "rename":
        tasks.rename(g, body.get("id"), str(body.get("to") or ""))
        srv.hub.ring(None, what="list")
    else:
        raise ValueError("do what? One of add, out, rename")
    now = time.time()
    return answer({"tasks": tasks.stored(), "now": now, **got})


@router.post("/api/gatherer-folders")
def gatherer_folder(srv: Parts, body: Body) -> Response:
    """{do, ...}: the folders gatherers are kept in changed (gatherer_folders.py) -> {gatherer_folders: all, made?}.

    new {name, parent?} (made: its id), rename {id, to}, move {id, parent?} (a folder put in another; none: at the
    top), delete {id} (what was in it moved up), file {gatherers, folder?} (gatherers put in a folder; none: at the top)."""
    do, parent = str(body.get("do") or ""), body.get("parent")
    parent = None if parent in (None, "") else parent
    made = None
    if do == "new":
        made = gatherer_folders.make(str(body.get("name") or ""), parent)
    elif do == "rename":
        gatherer_folders.rename(body.get("id"), str(body.get("to") or ""))
    elif do == "move":
        gatherer_folders.move(body.get("id"), parent)
    elif do == "delete":
        gatherer_folders.delete(body.get("id"))
    elif do == "file":
        names = body.get("gatherers")
        if not isinstance(names, list):
            raise ValueError("which gatherers? `gatherers`, a list")
        target = body.get("folder")
        gatherer_folders.file([str(g) for g in names], None if target in (None, "") else target)
    else:
        raise ValueError("do what? One of new, rename, move, delete, file")
    srv.hub.ring(None, what="list")
    return answer({"gatherer_folders": gatherer_folders.stored(), **({"made": made} if made is not None else {})})


@router.post("/api/name")
def name(srv: Parts, body: Body) -> Response:
    """{gatherer, channel, name, harness?, cwd?}: the reader's name for the actor ("": none) -> {name, store, error,
    terminal}.

    A `name` event in its gatherer, put in by ag (naming.py), given to its harness's own store too (`store`: what was
    done there, `error`: why not), and -- where the dashboard runs its terminal -- typed there as the harness's own
    command once its turn is over (sessions.py's `rename`; `terminal`: held for it)."""
    g, c, given = str(body.get("gatherer") or ""), str(body.get("channel") or ""), naming.clean(body.get("name"))
    naming.record(g, c, given)
    harness = str(body.get("harness") or "") or None
    out = {"name": given, "store": None, "error": None, "terminal": False}
    try:
        out["store"] = naming.in_store(harness, c, given, str(body.get("cwd") or "") or None)
    except harness_kit.RenameError as exc:
        out["error"] = str(exc)
    rules = harness_kit.get(harness)
    command = rules.rename_command(given) if rules is not None else None
    out["terminal"] = bool(command) and srv.sessions.rename(c, command)
    srv.hub.ring(g, c)                           # every open page's home: one types it, once it may
    return answer(out)


@router.post("/api/seen")
def look(body: Body) -> Response:
    """{seen: [[gatherer, channel, last], ...]}: those actors looked at, each with its `last` (seen.py) -> every one
    seen. Not rung: a home costs every stream a read of every gatherer; the page that looked has it, the others with
    their next home (KEEPALIVE at most)."""
    return answer(seen.look(body.get("seen")))
