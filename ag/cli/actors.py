"""`ag actors`: the other actors of this session's gatherer, and the gatherer agent that coordinates them -- asked of
the dashboard that runs them (ag_dashboard/coordination.py), over its local API (POST /api/actors/<op>).

    ag actors [--all]                   the actors of the gatherer that are not closed (--all: every one): each one's
                                        id, name, status, harness, directory, what it was last asked and its recap
    ag actors show <actor>              one actor: that, what it said last, the files its latest turn changed
    ag actors who <file>                which actors of the gatherer changed the file in the last day, the latest first
    ag actors send <actor> <message>    a message to the actor (`gatherer`: the gatherer agent; - for the message: read
                                        from stdin), which it gets in its conversation now -- as a new turn, or in the
                                        one it is running -- saying who it is from
    ag actors new [--like A] [--cwd D] [--harness H] [--model M] [--name N] [--folder F] [--docwriter | --browser | --branch [--approve]] <message>
                                        a new actor in the gatherer, started with the message: in D, on H and M, as given,
                                        else as actor A has them, else as this one; in the dashboard's list, in folder F
                                        (a path, made if new). --docwriter: a DocWriter's actor,
                                        writing with the user on D's documents in DocWriter, in the dashboard, where its
                                        edits are proposals the user accepts or rejects. --branch: on a branch of its own,
                                        in a new git worktree of the repository D is in, what it changes there merged
                                        into D's checkout by the dashboard as it goes (--approve: each change waiting
                                        for the user to accept it in the Editor)
    ag actors when <actor> [--note T]   an update in this actor's conversation once the actor is done (with T, said back)
    ag actors watches | unwatch <n>     what this actor asked to be told and has not been; one of them dropped
    ag actors save <actor> [--folder F | --no-folder]
                                        the actor saved for later, as the bookmark in the dashboard's list saves one;
                                        put in folder F too (made if new), or at the gatherer's top (--no-folder)
    ag actors unsave <actor>            no longer saved (it stays in its folder)
    ag actors folders                   the gatherer's folders, as the dashboard's list has them: the actors in each,
                                        the folders in each, and the actors at the gatherer's top
    ag actors folder new <F> | rename <F> <name> | move <F> <G|top> | delete <F>
                                        a folder made (empty), renamed, put in folder G (or at the top), or deleted
                                        (what was in it moved up into the folder it was in)
    ag actors move <actor>... <F|top>   actors put in folder F (made if new), or at the gatherer's top

A folder is named by its path: its name after those of the folders it is in, joined by "/" (`Harnesses/Codex`).
Folders only organise the dashboard's list: an actor shares the gatherer's context whatever folder it is in.

An actor is named by its id (or its first characters), its name, or `gatherer` for the gatherer agent. Who asks is the
session the command runs in, as its harness says (CLAUDE_CODE_SESSION_ID, CODEX_THREAD_ID), else AG_ACTOR (which the
dashboard sets in the sessions it starts), else `--as <id>`. The dashboard is AG_DASHBOARD's (which it sets too), else
the one the home names (<home>/dashboard/address.json). `--json` prints its answer as JSON. Standard library only."""

import argparse
import errno
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import List, Optional

import harness_kit

from . import config

ACTOR_VARS = ("CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "AG_ACTOR")   # the asker's id: its harness's, else the dashboard's
DASHBOARD_VAR = "AG_DASHBOARD"
TIMEOUT = 120               # a message may open the actor's terminal first
#: A connection refused by the sandbox the command runs in, not by the dashboard -- macOS's seatbelt and Linux's seccomp,
#: as Codex runs its commands: no network, even to this machine.
SANDBOXED = (errno.EPERM, errno.EACCES)


class ActorsError(Exception):
    pass


def actor_id(env=None, given: Optional[str] = None) -> Optional[str]:
    env = os.environ if env is None else env
    return given or next((env[v] for v in ACTOR_VARS if env.get(v)), None)


def dashboard_url(env=None) -> Optional[str]:
    env = os.environ if env is None else env
    if env.get(DASHBOARD_VAR):
        return env[DASHBOARD_VAR].rstrip("/")
    try:
        with open(os.path.join(config.home(), "dashboard", "address.json"), encoding="utf-8") as fh:
            return str(json.load(fh)["url"]).rstrip("/")
    except (OSError, ValueError, KeyError, TypeError):
        return None


def ask(url: str, op: str, body: dict, api: str = "actors") -> dict:
    """The dashboard's answer to `op` (of /api/<api>/: `ag actors`'s, or `ag preview`'s); ActorsError with its error's
    text."""
    req = urllib.request.Request(f"{url}/api/{api}/{op}", data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            raise ActorsError(json.loads(exc.read()).get("error") or f"the dashboard answered {exc.code}") from None
        except ValueError:
            raise ActorsError(f"the dashboard answered {exc.code}") from None
    except (urllib.error.URLError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        if getattr(reason, "errno", None) in SANDBOXED:
            raise ActorsError(f"a sandbox keeps this command from reaching the dashboard at {url} ({reason}): run the "
                              "same command again outside the sandbox -- in Codex, with sandbox_permissions "
                              '"require_escalated" -- as it only talks to the dashboard on this machine') from None
        raise ActorsError(f"no dashboard answers at {url} ({reason}): actors reach one another "
                          f"through the dashboard that runs them (`ag dashboard`)") from None


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="ag actors", description="The other actors of this session's gatherer, and the "
                                 "gatherer agent that coordinates them.")
    ap.add_argument("--as", dest="who", help="ask as this actor (its id), not the session the command runs in")
    ap.add_argument("--json", action="store_true", help="print the answer as JSON")
    ap.add_argument("--all", action="store_true", help="with no command (a list): closed actors too")
    sub = ap.add_subparsers(dest="op")
    ls = sub.add_parser("list", help="the actors of the gatherer that are not closed")
    ls.add_argument("--all", action="store_true", help="closed ones too")
    sub.add_parser("show", help="one actor: what it was asked, said last, and changed").add_argument("actor")
    sub.add_parser("who", help="which actors changed a file in the last day").add_argument("file")
    send = sub.add_parser("send", help="a message to an actor (`gatherer`: the gatherer agent)")
    send.add_argument("actor")
    send.add_argument("message", nargs="+", help="its words (- reads them from stdin)")
    new = sub.add_parser("new", help="a new actor in the gatherer, started with a message")
    new.add_argument("--like", help="in the directory, harness and model of this actor")
    new.add_argument("--cwd", help="the directory it works in")
    new.add_argument("--harness", choices=harness_kit.runnable(), help="the harness it runs on (default: the --like actor's, else yours)")
    new.add_argument("--model")
    new.add_argument("--name", help="its name in the dashboard")
    new.add_argument("--folder", help="in this folder of the dashboard's list (a path, made if new)")
    new.add_argument("--docwriter", action="store_true",
                     help="a DocWriter's actor: it writes with the user on the directory's documents in DocWriter, in "
                          "the dashboard, where its edits are proposals the user accepts or rejects")
    new.add_argument("--browser", action="store_true",
                     help="a Browser's actor: it uses a Chrome tab in the dashboard together with the user, who sees "
                          "and uses the page in its Browser view")
    new.add_argument("--branch", action="store_true",
                     help="on a branch of its own: a new git worktree of the repository its directory is in, what it "
                          "changes there merged into that repository's checkout by the dashboard as it goes")
    new.add_argument("--approve", action="store_true",
                     help="with --branch: each change it makes waits for the user to accept it in the Editor")
    new.add_argument("message", nargs="+", help="its first message (- reads it from stdin)")
    when = sub.add_parser("when", help="an update in your conversation once an actor is done")
    when.add_argument("actor")
    when.add_argument("--note", default="", help="what to do then: said back in the message")
    sub.add_parser("watches", help="what you asked to be told, and have not been yet")
    sub.add_parser("unwatch", help="drop one of them").add_argument("watch", type=int)
    save = sub.add_parser("save", help="an actor saved for later, put in a folder too if given")
    save.add_argument("actor")
    where = save.add_mutually_exclusive_group()
    where.add_argument("--folder", help="put in this folder (a path, made if new)")
    where.add_argument("--no-folder", dest="unfiled", action="store_true", help="put at the gatherer's top, in no folder")
    sub.add_parser("unsave", help="an actor no longer saved for later").add_argument("actor")
    sub.add_parser("folders", help="the gatherer's folders, and what is in each")
    move = sub.add_parser("move", help="actors put in a folder (made if new), or at the gatherer's top")
    move.add_argument("actors", nargs="+", help="the actors, then the folder's path (or `top`)")
    move.add_argument("--group", help="into another group (its folder, or `top`): they share with its actors then, "
                                      "each with its task; only when the user asks")
    sub.add_parser("alone", help="an actor taken out of every group: it works on its own, sharing context with no one; "
                                 "only when the user asks").add_argument("actor")
    folder = sub.add_parser("folder", help="a folder made, renamed, moved or deleted")
    do = folder.add_subparsers(dest="do", required=True)
    do.add_parser("new", help="a new folder, empty").add_argument("name")
    rename = do.add_parser("rename", help="a folder renamed, what is in it still in it")
    rename.add_argument("name", help="its path")
    rename.add_argument("to", help="its new name")
    moved = do.add_parser("move", help="a folder, and all in it, put in another folder (or at the top)")
    moved.add_argument("name", help="its path")
    moved.add_argument("to", help="the other folder's path, or `top`")
    moved.add_argument("--group", help="of another group: the folder's actors share with its actors then; only when "
                                       "the user asks")
    do.add_parser("split", help="a folder made a group of its own, named after it, what is in it at its top; only "
                                "when the user asks").add_argument("name")
    do.add_parser("delete", help="a folder deleted: what was in it moves up into the folder it was in").add_argument("name")
    return ap


def _words(parts: List[str]) -> str:
    return sys.stdin.read() if parts == ["-"] else " ".join(parts)


def main(argv: List[str]) -> int:
    opts = parser().parse_args(argv)
    op = opts.op or "list"
    try:
        me = actor_id(given=opts.who)
        if not me:
            raise ActorsError("which actor asks? Run it in an actor's shell, where its harness says which session it is "
                              "(or give --as <id>)")
        url = dashboard_url()
        if not url:
            raise ActorsError(f"no dashboard runs on this home ({config.home()}): actors reach one another through "
                              f"the dashboard that runs them (`ag dashboard`)")
        body = {"actor": me}
        if op == "list":
            body["all"] = bool(opts.all)
        elif op in ("show", "send", "when", "save", "unsave", "alone"):
            body["ref"] = opts.actor
        if op == "save":
            if opts.folder is not None:
                body["folder"] = opts.folder
            if opts.unfiled:
                body["unfiled"] = True
        if op == "folder":
            body.update({"do": opts.do, "name": opts.name, **({"to": opts.to} if opts.do in ("rename", "move") else {}),
                         **({"group": opts.group} if getattr(opts, "group", None) else {})})
        if op == "move":
            if len(opts.actors) < 2:
                raise ActorsError("move which actors where? `ag actors move <actor>... <folder|top>`")
            body.update({"refs": opts.actors[:-1], "folder": opts.actors[-1], **({"group": opts.group} if opts.group else {})})
        if op == "who":
            body["path"] = os.path.abspath(os.path.expanduser(opts.file))
        if op in ("send", "new"):
            body["text"] = _words(opts.message)
        if op == "new":
            body.update({k: getattr(opts, k) for k in ("like", "cwd", "harness", "model", "name", "folder") if getattr(opts, k)})
            if body.get("cwd"):
                body["cwd"] = os.path.abspath(os.path.expanduser(body["cwd"]))
            for flag in ("docwriter", "browser", "branch", "approve"):
                if getattr(opts, flag):
                    body[flag] = True
        if op == "when":
            body["note"] = opts.note
        if op == "unwatch":
            body["watch"] = opts.watch
        got = ask(url, op, body)
    except ActorsError as exc:
        print(f"ag actors: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(got, indent=2) if opts.json else shown(op, got))
    return 0


# ---- what each answer prints

def _short(path: str) -> str:
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path == home or path.startswith(home + "/") else path


def _place(cwd: Optional[str]) -> str:
    return " in " + _short(cwd) if cwd else ""


def _who(a: dict) -> str:
    """An actor in a line: its id, its name, whether it is the gatherer agent or the asker, its status, harness, place."""
    marks = [m for m in ("the gatherer agent" if a.get("gatherer_agent") else None, "a DocWriter" if a.get("docwriter") else None,
                         "a Browser" if a.get("browser") else None,
                         "saved" if a.get("saved") else None, 'in "%s"' % a["folder"] if a.get("folder") else None,
                         "you" if a.get("you") else None) if m]
    name = ' "%s"' % a["name"] if a.get("name") and not a.get("gatherer_agent") else ""
    what = ", ".join(x for x in (a.get("status"), a.get("harness")) if x)
    return str(a.get("id")) + name + (" (%s)" % ", ".join(marks) if marks else "") + (" -- " + what if what else "") \
        + ("," if what and a.get("cwd") else "") + _place(a.get("cwd"))


def _ago(at) -> str:
    if not at:
        return ""
    s = max(0, int(time.time() - at))
    return f"{s}s ago" if s < 90 else f"{s // 60} min ago" if s < 5400 else f"{s // 3600} h ago"


def shown(op: str, got: dict) -> str:
    if op == "list":
        lines = [f'Actors of the gatherer {got["gatherer"]} (you are {got["you"]}):']
        for a in got["actors"]:
            lines.append(f"- {_who(a)}")
            if a.get("asked"):
                lines.append(f"    last asked: {a['asked']}")
            if a.get("recap"):
                lines.append(f"    recap: {a['recap']}")
        if not any(a.get("gatherer_agent") for a in got["actors"]):
            lines.append("The gatherer has no gatherer agent yet: `ag actors send gatherer ...` starts one.")
        if got.get("closed"):
            lines.append(f"({got['closed']} closed, not listed: --all lists them.)")
        return "\n".join(lines)
    if op == "show":
        lines = [f"Actor {_who(got)}", f"It was asked: {got.get('asked') or '(nothing yet)'}"]
        if got.get("said"):
            lines.append(f"It said last: {got['said']}")
        now = got.get("now") or {}
        if now.get("kind") == "call":
            lines.append(f"Doing now: {now.get('text')}")
        elif now.get("kind") == "thinking":
            lines.append("Doing now: thinking")
        lines.append("Files its latest turn changed: " + (", ".join(got["changed"]) if got.get("changed") else "none"))
        return "\n".join(lines)
    if op == "who":
        if not got["actors"]:
            return f"No actor of the gatherer changed {got['path']} in the last day."
        return "\n".join([f"Actors that changed {got['path']} in the last day, the latest first:"]
                         + [f"- {_who(a)}: {a['how']} it {_ago(a['at'])}" for a in got["actors"]])
    if op == "send":
        to = got["to"]
        who = "the gatherer agent" if to.get("gatherer_agent") else "actor %s" % to["id"] + (' ("%s")' % to["name"] if to.get("name") else "")
        return f"Sent to {who}: it gets your message now, as a new turn or during the one it is running."
    if op == "new":
        a = got["actor"]
        if got.get("docwriter"):
            return (f"Started actor {a['id']} ({a.get('harness')},{_place(a.get('cwd'))}), a DocWriter, with your message. "
                    f"Its edits to the documents are proposals: they reach the files once the user accepts them in its "
                    f"DocWriter view (the dashboard, its actor selected).")
        if got.get("browser"):
            return (f"Started actor {a['id']} ({a.get('harness')},{_place(a.get('cwd'))}), a Browser, with your message. "
                    f"It uses a Chrome tab in the dashboard together with the user, who sees the page in its Browser view "
                    f"(the dashboard, its actor selected) and can log in there for it.")
        b = got.get("branch")
        if b:
            merged = (" each change waiting for the user to accept it in the Editor" if b.get("approve") else
                      " as it goes, but for lines the user is editing in the Editor or changed too, which wait for them there")
            return (f"Started actor {a['id']} ({a.get('harness')},{_place(a.get('cwd'))}) with your message, on its own "
                    f"branch {b['branch']} of {_short(b['project'])}. The dashboard merges what it "
                    f"changes there into that checkout,{merged}; nothing is committed.")
        return f"Started actor {a['id']} ({a.get('harness')},{_place(a.get('cwd'))}) with your message" \
            + (f', in the folder "{a["folder"]}".' if a.get("folder") else ".")
    if op == "when":
        t = got["target"]
        return (f"Watch {got['watch']}: an update comes in your conversation once actor {t['id']} is done"
                + (f" (it is {t['status']} now)." if t.get("status") else "."))
    if op == "watches":
        if not got["watches"]:
            return "You are waiting to be told nothing."
        return "\n".join([f"- watch {w['watch']}: actor {w['target'].get('id')}'s turn over" + (f" -- {w['note']}" if w.get("note") else "")
                          for w in got["watches"]])
    if op == "unwatch":
        return f"Watch {got['dropped']} dropped."
    if op in ("save", "unsave"):
        a = got["actor"]
        who = "Actor %s" % a["id"] + (' ("%s")' % a["name"] if a.get("name") else "")
        where = 'in the folder "%s"' % a["folder"] if a.get("folder") else "at the gatherer's top"
        if not a.get("saved"):
            return f"{who} is no longer saved ({where})."
        return f"{who} is saved for later, {where}."
    if op == "move":
        top = f"at the top of the group {got['group']}" if got.get("group") else "at the gatherer's top"
        where = 'in the folder "%s"' % got["folder"] if got.get("folder") else top
        if got.get("group") and got.get("folder"):
            where += f" of the group {got['group']}"
        return "\n".join([f"Now {where}:"] + [f"- {_who({**a, 'folder': None})}" for a in got["actors"]])
    if op == "alone":
        return (f"{_who({**got['actor'], 'folder': None})} works on its own now: it shares context with no other actor, "
                "and no other actor with it. Move it into a group (`ag actors move ... --group`) to bring it back.")
    if op in ("folders", "folder"):
        lines = []
        if op == "folder":
            into = f" of the group {got['group']}" if got.get("group") else ""
            lines.append({"new": 'Folder "{name}" made.', "rename": 'Folder "{name}" renamed "{to}".',
                          "move": ('Folder "{name}" put in "{to}"' if got.get("to") else 'Folder "{name}" put at the top')
                          + into + ".",
                          "split": 'Folder "{name}" is a group of its own now: {group}, what was in it at its top.',
                          "delete": 'Folder "{name}" deleted: what was in it moved up a level.'}[got["done"]].format(**got))
        if not got["folders"] and not got["actors"] and not got["closed"]:
            lines.append(f"The gatherer {got['gatherer']} has no folders, and no actors but the gatherer agent.")
            return "\n".join(lines)
        lines.append(f"Folders of the gatherer {got['gatherer']}:" if got["folders"] else f"The gatherer {got['gatherer']} has no folders.")

        def tree(node: dict, depth: int) -> None:
            pad = "  " * depth
            for f in node["folders"]:
                closed = f" ({f['closed']} closed)" if f["closed"] else ""
                lines.append(f'{pad}- folder "{f["path"]}"' + (" -- closed" if f.get("shut") else "")
                             + ("" if f["actors"] or f["folders"] or f["closed"] else " (empty)") + closed)
                lines.extend(f"{pad}    {_who({**a, 'folder': None})}" for a in f["actors"])
                tree(f, depth + 1)
        tree(got, 0)
        if got["actors"] or got["closed"]:
            lines.append("- at the gatherer's top" + (f" ({got['closed']} closed)" if got["closed"] else ""))
            lines.extend(f"    {_who({**a, 'folder': None})}" for a in got["actors"])
        return "\n".join(lines)
    return json.dumps(got, indent=2)
