"""The sessions started from the page (sessions.py): started, sent messages, stopped, discarded; a question its
terminal asks answered; the gatherer agent; what actors' `ag actors` ask (coordination.py)."""

import harness_kit
from fastapi import APIRouter
from starlette.responses import Response

from .. import coordination, data, home, sessions
from .common import Body, Errors, Parts, answer

router = APIRouter(route_class=Errors)


@router.get("/api/sessions")
def listed(srv: Parts) -> Response:
    """The sessions started from the page (sessions.py)."""
    return answer(srv.sessions.list())


@router.get("/api/models")
def models(harness: str = "") -> Response:
    """?harness=H: the models a new session of H can run on (sessions.py's `models`)."""
    return answer(sessions.models(harness))


@router.post("/api/sessions")
def start(srv: Parts, body: Body) -> Response:
    """{gatherer, cwd?, permission_mode?, harness?, model?}: a new session (harness claude, the default, or codex) ->
    the session."""
    return answer(srv.sessions.create(str(body.get("gatherer") or ""), str(body.get("cwd") or ""),
                                      str(body.get("permission_mode") or "auto"),
                                      str(body.get("harness") or harness_kit.DEFAULT),
                                      str(body.get("model") or "") or None))


@router.post("/api/send")
def send_message(srv: Parts, body: Body) -> Response:
    """{session_id, text, cols?, rows?, fullscreen?, cid?} or {gatherer, channel, text, ...}: a message to the session ->
    the session. `cid`: the send's id, as the page knows it (Chat's view, chat_view.py, tells the message it became by it).

    Typed into its terminal, or one opened for it (that size, that screen), or to its agent (sessions.py's `send`);
    a Claude Code or codex session not started here (gatherer, channel) taken into the table first (sessions.py's
    `adopt`). While the codex in the dashboard's terminal asks whether to implement its plan, what to change instead
    ("No, stay in Plan mode", then the message); refused while it waits on a question there (`dialog`), and while its
    terminal's message box is not there, empty, to take it -- a dialog, a menu, a question, a permission asked, or
    something typed there and not sent: the error then has `box` (sessions.py's NotAtBox). The message goes as typed:
    an app tells its agent what it needs to by events of its own (a Browser: what the user did and picked in it)."""
    started = srv.sessions
    sid = str(body.get("session_id") or "")
    if not sid and body.get("gatherer") and body.get("channel"):     # a session not started here
        sid = started.adopt(str(body["gatherer"]), str(body["channel"]))["session_id"]
    text = str(body.get("text") or "")
    held = srv.dialog(sid)
    if held is not None and held.get("kind") == "plan":     # what to change: its plan dialog's own way to say it
        started.answer(sid, held, {"plan": "change", "text": " ".join(text.split())})
        return answer(next(x for x in started.list() if x["session_id"] == sid))
    if held is not None:
        rules = harness_kit.get(held.get("harness"))
        raise sessions.SessionError(f"{rules.label if rules else 'It'} waits on its question in the "
                                    "terminal: answer it, or press Esc there to stop the turn, first")
    sent = started.send(sid, text, int(body.get("cols") or 120), int(body.get("rows") or 32), bool(body.get("fullscreen")),
                        str(body.get("cid") or "") or None)
    return answer(sent)


@router.post("/api/upload")
def upload(body: Body) -> Response:
    """{type, data (base64)}: a file pasted into a message, kept in the home for its agent to read (home.py's
    `save_upload`) -> where."""
    return answer(home.save_upload(str(body.get("type") or ""), str(body.get("data") or "")))


@router.post("/api/stop")
def stop(srv: Parts, body: Body) -> Response:
    """{session_id}: its agent, idle, ended -- or its terminal closed -> the session."""
    return answer(srv.sessions.stop(str(body.get("session_id") or "")))


@router.post("/api/discard")
def discard(srv: Parts, body: Body) -> Response:
    """{session_id}: one that never started -- no process of it running, nothing of it in its gatherer -- forgotten:
    listed nowhere, nothing of it kept (sessions.py's `discard`) -> {}."""
    sid = str(body.get("session_id") or "")
    row = next((x for x in srv.sessions.list() if x["session_id"] == sid), None)
    if row is None:
        raise sessions.SessionError(f"no session {sid} started from the dashboard")
    if data.actors(row["gatherer"], {sid}, []):   # its gatherer has something of it: a history to keep
        raise sessions.SessionError("it has a conversation in its gatherer: close it instead")
    srv.sessions.discard(sid)
    if srv.branches is not None:                 # its branch, if it had one: gone too
        srv.branches.discarded(sid)
    srv.hub.ring(None, what="list")              # every open page's list
    return answer({})


@router.post("/api/answer")
def answer_ask(srv: Parts, body: Body) -> Response:
    """{session_id, id, choice}: what it asks (data.py's `asking`: a question, a plan, a permission -- the one whose id
    is `id`; `call`, as the page named it before), answered with `choice` (answers.py) -> the answer. The one path for
    every kind: the dashboard's terminal for the session answered with its dialog's keys (sessions.py's `answer`)."""
    sid = str(body.get("session_id") or "")
    row = next((x for x in srv.sessions.list() if x["session_id"] == sid), None)
    if row is None:
        raise sessions.SessionError(f"no session {sid} started from the dashboard")
    ask = data.asking_of(row["gatherer"], sid, row.get("cwd"))
    if not ask or (ask.get("id") or ask.get("call")) != (body.get("id") or body.get("call")):
        raise sessions.SessionError("it no longer asks that")
    choice = body.get("choice")
    return answer(srv.sessions.answer(sid, ask, choice if isinstance(choice, dict) else {}))


@router.post("/api/coordinator")
def coordinator(srv: Parts, body: Body) -> Response:
    """{gatherer, cwd?, harness?}: the gatherer's gatherer agent, started (with no message yet) if it has none
    (coordination.py) -> the session."""
    return answer(srv.crew.page_coordinator(str(body.get("gatherer") or ""), str(body.get("cwd") or "") or None,
                                            str(body.get("harness") or "") or None))


def actors_op(crew: coordination.Coordination, op: str, body: dict):
    """What an actor's `ag actors <op>` asked: the coordination's answer."""
    s = lambda k: str(body.get(k) or "")              # noqa: E731
    opt = lambda k: s(k) or None                      # noqa: E731
    me = s("actor")
    if op == "list":
        return crew.list(me, bool(body.get("all")))
    if op == "show":
        return crew.show(me, s("ref"))
    if op == "who":
        return crew.who(me, s("path"))
    if op == "send":
        return crew.send(me, s("ref"), s("text"))
    if op == "new":
        return crew.new(me, s("text"), opt("cwd"), opt("harness"), opt("model"), opt("like"), opt("name"),
                        branch=bool(body.get("branch")), approve=bool(body.get("approve")), folder=opt("folder"),
                        **{n: True for n in coordination._starters() if body.get(n) is True})
    if op == "when":
        return crew.when(me, s("ref"), s("note"))
    if op == "watches":
        return crew.watches(me)
    if op == "unwatch":
        return crew.unwatch(me, body.get("watch"))
    if op == "save":
        return crew.save(me, s("ref"), opt("folder"), bool(body.get("unfiled")))
    if op == "unsave":
        return crew.unsave(me, s("ref"))
    if op == "folders":
        return crew.folders(me)
    if op == "folder":
        return crew.folder(me, s("do"), s("name"), s("to"), opt("group"))
    if op == "move":
        refs = body.get("refs")
        return crew.move(me, [str(r) for r in refs] if isinstance(refs, list) else [], s("folder"), opt("group"))
    if op == "alone":
        return crew.alone(me, s("ref"))
    raise coordination.CoordinationError(f"no `ag actors {op}`: one of list, show, who, send, new, when, watches, unwatch, "
                                         "save, unsave, folders, folder, move, alone")


@router.post("/api/actors/{op:path}")
def actors(srv: Parts, op: str, body: Body) -> Response:
    """{actor, ...}: what an actor's `ag actors <op>` asks (coordination.py; `actor`, its id) -> what it answers; an
    error's text for the command to print (400).

    list {all?}, show {ref}, who {path}, send {ref, text}, new {text, cwd?, harness?, model?, like?, name?, folder?,
    <app>? (an app that starts an agent of its own: docwriter?, browser?), branch?, approve?}, when {ref, note?}, watches, unwatch {watch},
    save {ref, folder?, unfiled?}, unsave {ref}, folders, folder {do: new | rename | move | split | delete, name, to?,
    group?}, move {refs, folder, group?} (folders: by path, "top" or none for the gatherer's top; group: another one,
    groups.py), alone {ref}."""
    return answer(actors_op(srv.crew, op, body))
