# Apps beside agents: plan

Status: being built, from 2026-11-06. Steps 1 (`app_kit/`), 2 (the host), 3 (the tool gateway), 4 (app panels), 5 (Preview), 8 (DocWriter, the Browser; installing and uninstalling apps, from the Apps page) and 7's first part (the Editor as an app, the Preview taken into it) are built. This file is the package's design, as
`harness_kit/DESIGN.md` is that package's.

## Goal

A gatherer holds two kinds of things, and the code and the page should treat them as two kinds:

- **Agents.** The actors: harness sessions (Claude Code, Codex, ...) whose context the gatherer puts together. An
  agent's pane (Chat, Terminal, History, and the read-only Messages, Transcript and Details) shows that agent and
  nothing else. A way of looking at the agent's own history is part of its views, not an app: Chat's files and
  commands, and its file viewer, stay in Chat (decided 2026-11-07).
- **Apps.** Everything an agent or the user works *with*: the Editor, the Browser, DocWriter, Preview, and History's
  Summarize / Generate skill / memory / AGENTS.md. An app has a panel of its own, in the row above the agent panes
  (beside the Editor); opening it shows the agent attached to it below. The user talks to an agent in its own views
  (Chat, Terminal), right below the panel (decided 2026-11-07). An app whose own page has a request box today keeps
  it (DocWriter's: what the dashboard does now is kept), through a capability to message its attached agents.

An app reaches the rest of the system through two things only:

1. **Tools** an agent calls. The call is passed to the app, which answers it.
2. **Events** the app puts into the gatherer, by inserting them or through a poller.

ag and the dashboard know an app only through its manifest, which declares those tools and events, its pollers, what
agents are told about it, and its panel. No app is named in their code. Our own apps are built the way
an outside one would be, so that someone else's app can plug in the same way, and a later "app store" only has to
list them.

Agents and apps are linked many-to-many. An agent can use several apps, and an app can have several agents working
with it, or none.

## Words

| Word | Meaning |
|---|---|
| app | A package: a manifest, a backend and a panel. |
| instance | One opened copy of an app: a Browser with its tabs, DocWriter on a document, the Editor on a folder, Preview on a git checkout. The manifest says how many copies an app can have (`instances`). |
| attachment | An agent linked to an instance. The agent gets that instance's events, and its tool calls go to that instance. |
| panel | An instance's UI in the page. |
| host | What runs apps. The dashboard server runs their backends; the page shows their panels; the desktop app also gives native views. |
| intent | A request one part of the page makes without naming who handles it, such as "open this file at line 40". The host gives it to the app that declares it handles that kind. |

## Today

What each app-like piece does now (`main` at 93d768b):

| Piece | Where | Tools for agents | Events into the gatherer | State kept outside the gatherer | UI |
|---|---|---|---|---|---|
| Browser | `apps.py`'s `APPS`; `browser.py` (4,876 lines), `api/browser.py` | 19 tools (snapshot, click, type, navigate, ...) at an MCP endpoint per Browser, `/browser/w/<key>/mcp`, given only to its own actor at launch (`launch_args`) | Only the actor's `name`. The user's actions reach the actor inside the message text: `compose` adds a `<browser_state>` block to what the user sends (`/api/send`). What the user did during an action goes back in the tool's result. A message sent with `ag actors send` gets no `<browser_state>` | The `browser` table in `dashboard.db` (tabs), the Chrome profile, downloads and uploads under `<home>/dashboard/`, the shared Chrome and each Browser's picks and log in memory | Pane view `browser`, picked from the session's `role`; its own stream `/browser/w/<key>/stream`; the desktop app lays a native view over it |
| DocWriter | `apps.py`; `docwriter.py`, `docwriter_guard.py`, `api/docwriter.py` | MCP at `/docwriter/w/<key>/mcp`, for its own actor only. The page defines the tools and runs them: each call waits for an open DocWriter page (`PAGE_WAIT`). A Claude Code hook refuses the harness's own edits to an open document | `proposal_resolved`, `comment`, `reply`, `doc_settings` (`ag home insert`), which no policy and no view reads | `docwriter`, `docwriter_docs` (Yjs state per file) and `docwriter_kv` tables in `dashboard.db` | An iframe laid over pane view `docwriter`; the page builds the actor's `<workspace_state>` prompt (`render.ts`) |
| Editor | Not in `APPS`; named in `server.py` and `app.py`. `editor.py`, `api/editor.py`, `legacy/18-editor*.js` | None | None. It reads every gatherer's `file_touched` events to show who changed a file (`editor.writers`) | A Yjs document per open file, which follows the disk every 0.4 s with a three-way merge; conflicts in memory | Opened above the panes on a folder, not an actor; its own stream `/api/edit/stream` |
| Preview | Inside the Editor; named in `server.py`. `preview.py`, `api/preview.py` | `ag preview` in the actor's shell, to the dashboard's local API. Agents learn it from ag's gatherer guide (`proactive_context_manager/config.py`) | None | The `previews` table in `dashboard.db`; the runs in memory | The Editor's preview side; its own stream `/api/preview/stream`. Borrows DocWriter's pdf.js and SyncTeX |
| Branches | `branches.py`; named in `server.py` | `ag actors new --branch` | `context_stream` into the actor's channel when the reader rejects or edits its change (`branches.tell`) | `projects`, `branches`, `branch_files` tables in `dashboard.db` | Merges shown in the Editor |
| Files and commands, file viewer | Inside Chat. `files.py`, `/api/files`, `src/features/chat/files-view.js` | None | Reads `tool_call`, `tool_output`, `file_touched` (which ag's hook records, watching the disk as each call runs) and `actor_message` | None | Chat's left panel and file pane. The Editor's changes panel calls Chat's `fileBlock` |
| History actions | Inside History. `history.py`, `/api/history/extract`, `save`, `export` | None | None. They run through `ag home complete`; results are files in `<home>/dashboard/extracts/` | The extracts | History's right panel |
| Answer sources | Not on main (uncommitted in the `dashboard-answer-sources` worktree) | None | None | `<home>/dashboard/sources/` | A Details tab |
| Custom chat views | `agDashboard.chatView`, loaded from `<home>/dashboard/views/*.js` | None | None | None | Draws inside the pane. This is the only plug-in point the page has today |

What ties apps to agents and to the dashboard now:

1. **An app owns one actor.** A Browser or DocWriter actor is a session whose `role` is `{"<app>": key}`. Its tools
   are given only to that actor, at launch.
2. **`apps.App` is shaped around that actor**: `key_of(session)`, `launch_args(session)`, `compose(session, text)`.
3. **The dashboard writes messages for apps.** `/api/send` asks the app to compose the actor's message.
4. **The page picks a pane's view from the role** (`kindOf`), and app names appear in six of the legacy files.
5. **The Editor, Preview and the files panel are wired in directly**, in `server.py`, `app.py`, `api/*` and the
   legacy page.
6. **The desktop preload hard-codes the Browser**: the `.bw-stage` selectors, and CDP targets as the only thing a
   native view can show.
7. **The page has no layout model.** The arrangement is the `panes` object, DOM classes and about 40 localStorage
   keys.
8. **Only Claude Code and Codex can take an app's tools.** `launch_args` returns nothing for a harness without
   `mcp_args`, so a Browser or DocWriter started on Antigravity, Pi or OpenCode gets neither its tools nor its
   instructions.
9. **Events reach a context only as `context_stream` or `environment_update`.** That is not a problem; the design
   builds on it. `branches.tell` already uses `context_stream` to tell an actor what the reader did in the Editor.

## The design

### 1. An app is a manifest, a backend and a panel

```toml
# apps/browser/app.toml
name = "browser"                      # lowercase letters, digits and _: its tools' and event types' prefix
label = "Browser"
version = "0.4.0"
instances = "many"                    # one (per gatherer) | per-folder | per-checkout | many
instructions_file = "instructions.md" # what agents are told of it (or `instructions = "..."` inline)

[backend]
python = "ag_browser.app:BrowserApp"  # in the host's process
# command = ["node", "server.js"]     # or a process of its own, any language, speaking app_kit's HTTP protocol

[panel]
entry = "panel/index.html"            # a built web page; the host serves the folder on the app's own origin

[[tools]]                             # MCP tool definitions; agents see `browser_open`
name = "open"
description = "Open a page in a new tab."
input_schema = { type = "object", properties = { url = { type = "string" } }, required = ["url"] }
handled_by = "backend"                # or "panel": waits for an open panel, as DocWriter's tools do now

[[events]]                            # its own event types: records, never shown to a model
name = "browser.navigated"
properties = ["url"]                  # besides app, instance and channel, which the host sets

[[pollers]]                           # optional: ag pollers, built by ag in its own process (its catalog's shape)
name = "downloads"
file = "pollers.py"
class = "DownloadPoller"
args = { root = "{cwd}" }

[[handles]]                           # intents it takes (for open-file, `types = ["application/pdf"]` narrows it)
intent = "open-url"

[[schedules]]                         # work its backend does on its own (5c): App.scheduled("listing", due)
name = "listing"
at = "00:15"                          # times of day, or `every = "30m"`
days = ["mon", "tue", "wed", "thu", "fri"]
timezone = "America/New_York"         # none: this computer's

[capabilities]                        # shown to the user before they are granted
native_view = true                    # desktop: a native web view over its panel
notify = true                         # notifications to the user (5b)
reads = ["tool_call", "tool_output"]  # other event types it may read, besides its own and the context types
```

`app_kit.load(folder)` reads and checks it: a key it doesn't know, a capability the host can't show the user, a
tool the backend handles in an app with no backend, or a file outside the app's folder is a `ManifestError` naming
the key.

The backend, in Python (`app_kit/backend.py`), every method with a default:

```python
class App:
    manifest: Manifest; host: Host                              # set by the host
    def start(self, host: Host) -> None: ...                    # once, before anything else
    def stop(self) -> None: ...
    def open(self, instance: Instance, args: dict) -> Instance: ...   # the host made its id, gatherer, folder;
    def close(self, instance: Instance) -> None: ...                  # the app sets its title and data
    def sleep(self, instance: Instance) -> None: ...                  # its task closed: kept, nothing run for it
    def folded(self, instance, was: str, title: str) -> None: ...     # group `was` merged into the instance's:
                                                                      # what it keeps per group carried over
    def call(self, instance, tool: str, args: dict, caller: Caller) -> ToolResult: ...
    def request(self, instance, method, path, query, body: bytes) -> Response: ...   # its panel's own routes
    def attached(self, instance, channel: str) -> None: ...     # an agent attached: tell it what it needs to know
    def detached(self, instance, channel: str) -> None: ...
    def scheduled(self, schedule: str, due: float) -> Optional[float]: ...   # a [[schedules]] run (5c): retry in s

class Host(ABC):                                                # what an app is given
    def insert(self, instance, events: List[dict], channel: Optional[str] = None) -> None: ...
    def read(self, instance, types, after=0, channel=None, limit=500) -> List[dict]: ...
    def attached(self, instance) -> List[str]: ...              # the channels of its agents
    def tell_panel(self, instance, message: dict) -> None: ...  # to its open panels
    def folder(self) -> str: ...                                # its own files: <home>/apps/<name>/data
    def instances(self) -> List[Instance]: ...
    def notify(self, instance, title, text="", key=None, show=("ag",), where=None) -> str: ...   # to the user
    def clear_notice(self, instance, which: str) -> None: ...   # one of its own (an id), or every one of a key
    def send_agent(self, instance, channel, text) -> None: ...  # message_agents: to an attached agent, as the user
    def start_agent(self, instance, text, name=None, harness=None, model=None, folder=None) -> str: ...   # and a new
                                                                # agent of its own, attached, with a first message
```

An app in its own process gets the same calls over HTTP (`app_kit/remote.py`). The host starts the manifest's
`command` in the app's folder with `AG_APP_HOST`, `AG_APP_TOKEN` and `AG_APP_DATA` set; the app prints
`{"url": ...}` and from then on each side POSTs JSON to the other, with the token. `python -m app_kit.remote
module:Class` runs an `App` subclass that way. An app in its own process has no pollers (ag builds those in its own
process from the manifest); it inserts instead.

### 2. Events: what an app puts into the gatherer

An app's events are ag's own, and ag's context management is used as it is: no policy, poller or store code changes
for apps. An app's event types are ag `EventType`s with ag `Property`s (`Manifest.event_types`), its pollers ag
`Poller`s built by ag's catalog, and what it inserts goes in ag's insert shape, as the hooks' records do.


- **Its own types are records.** They are named `<app>.<what>`, for example `browser.navigated`,
  `docwriter.proposal_resolved`, `preview.ran` or `editor.saved`. No policy groups them, so they never reach a
  model's context, the same as the harness records (`model_call`, `file_touched`, ...). Each carries `app` (stamped
  by the host), `instance`, and `channel` when it is about one agent.
- **What agents should know goes in as `context_stream` or `environment_update`.** The policy already shows these:
  - a `context_stream` event as a message at its place ("In the Browser, the user picked: ...");
  - an `environment_update` when something an agent opened has changed.

  With an attached agent's channel, only that agent sees it. With no channel, every agent in the gatherer does. No
  policy changes.
- **Two ways in**, as the request says:
  - **Insert:** `host.insert`, which goes through ag's server on its records lane, the way the hooks insert records.
    `ag home insert` stays for scripts.
  - **Poller:** the manifest's `[[pollers]]` name ag `Poller` classes in the app's folder. ag builds them in its own
    process, as it builds a `[pollers.available]` entry now; turning the app on for a gatherer adds them to that
    gatherer's pollers, as `<app>.<name>`.
- **The host checks every insert.** An app may insert only its own `<app>.*` types, `context_stream` and
  `environment_update`. The host stamps `app` on each event, so no app can pass its events off as another app's, a
  harness's or the user's.
- **Some state stays outside events.** A Chrome profile, Yjs documents, built PDFs and video live in the app's own
  folder, `<home>/apps/<name>/`. The rule is: whatever an agent, another app or the user's history should see is an
  event; the rest is the app's own business.
- **Panels read events instead of each app's own routes.** The host serves one read and one subscription over the
  page's WebSocket, filtered by types, instance, channel and since. An app keeps its own routes only for data that
  isn't events, such as Browser frames or Yjs updates; the host proxies them under `/apps/<name>/`.

### 3. Tools: what agents call

- **Declared in the manifest** as MCP tool definitions. Each is handled by the backend, or by the open panel.
- **One MCP endpoint per agent**, `/mcp/<channel>`, served by the dashboard's tool gateway. It replaces one endpoint
  per app instance. It lists the tools of every app turned on for the gatherer, named `<app>_<tool>`, and sends each
  call to the instance the agent is attached to:
  - an `instance` argument picks one when the agent is attached to more than one (the host adds it to every
    tool's schema, so no tool may name its own argument `instance`);
  - with none attached, the call opens the app's instance for the agent's gatherer and folder (the open one, for an
    app with one per folder or checkout) and attaches the agent.
- **Every session gets it at launch.** `sessions.extra_args` gives the gateway's endpoint to every session through
  harness_kit's `mcp_args`, where today each app's `launch_args` gives its tools to its own actor.
- **Instructions go with the tools, not through ag's policy.** The gateway's MCP server answers `initialize` with the
  apps' instructions, which Claude Code adds to its system prompt (as this session's own prompt shows for its MCP
  servers). A harness given no MCP server but taking instructions (Antigravity) gets them through
  `instruction_args`, naming `ag apps`. ag's gatherer guide, and the policy around it, stay as they are. Pi and
  OpenCode take neither from the dashboard: `ag apps` works for them, but nothing tells them it exists yet.
- **Agents on harnesses ag gives no MCP to** (Antigravity, Pi and OpenCode: `mcp_args` is `None`) use
  `ag apps call <app> <tool> '<json>'` in their shell. It goes through the same gateway, which knows the caller from
  the session the command runs in, as `ag actors` and `ag preview` work now. `ag preview` becomes this.
- **From an agent's own Python** (2026-11-19): `import agapps` (`ag/cli/pylib/agapps.py`), then
  `agapps.app("notes").read(page=...)`. Each method is one call of the app's tool through the same gateway
  (`/api/apps/agent/call`, as `ag apps call`), so the access check, the instance it goes to, the `app_call` record and
  the panel's update are all the same as for an MCP call. A script can loop over calls and keep what they return out of
  the agent's context. Only Python changes on the agent's side, not where the work happens: the app's own libraries
  (python-pptx, a Google SDK) run in its backend, never in the agent's process, where nothing would check them.
  - Standard library only, Python 3.8 on: it runs in whatever Python the agent's script runs in, not ag's.
  - ag's launcher puts its folder at the end of `PYTHONPATH` in every session it starts (`main.PYLIB`), and every
    agent's apps instructions name it (`tool_gateway.PYTHON`).
  - A result comes back as its text, its JSON parsed, or an `Image`; a refusal raises `agapps.AppError`.
  - Who calls is read from the session's environment, as for `ag apps`. A sandbox with no network (Codex's) needs the
    script run outside it, as `ag apps` does.
- **A record of each call.** The harness already records the call and its result in the agent's channel
  (`tool_call`, `tool_output`). The gateway also inserts an `app_call` record (instance, tool, caller, ok), so a
  panel can show "this agent did that" without reading the agents' own events.
- **Listing tools at launch has a cost.** We give Claude Code its MCP tools with `alwaysLoad`, so each listed tool is
  in every agent's context. The choices are under Decisions (2).

### 4. Agents and apps

- **An attachment is an event.** `app_attached {app, instance, by}` and `app_detached` are records in the agent's
  channel; an agent's attachments are the latest one per instance. They replace the session's `role`. A stored role
  `{"browser": key}` is copied to an `app_attached` once, as the harness migration copied old tables.
- **Who attaches:**
  - the user, by putting an actor in the app's task (dropped on its row in the list, or its "+"), or by starting a new
    actor from a panel;
  - the gatherer agent, with `ag actors new --app <name>` or `ag apps attach`. `--browser` and `--docwriter` stay as
    aliases.
  - an agent itself, by calling a tool that opens an instance.
- **"An app's own actor" stops being a special kind.** What is now a Browser actor becomes an ordinary actor that
  started attached to a Browser. Its pane shows Chat, Terminal and History like any other actor, and the Browser
  panel sits beside it.
- **The user's actions in an app reach its agents as events.** The app inserts a `context_stream` into each attached
  agent's channel, and the policy places it at that agent's next model call. This replaces the Browser's `compose`
  and DocWriter's prompt built in the page. The message the user types goes to the agent unchanged, and the
  dashboard never writes a message for an app.
- **An app that needs a model makes its own calls.** Answer sources, and Summarize / Generate skill, can call the
  model in the backend with the home's LLM settings, or start an agent attached to the app. ag doesn't need to know
  which.

### 4b. Who may use an instance, and what agents know of the apps (decided 2026-11-18)

- **Access, said by the manifest and checked at every call** (`ag_dashboard/access.py`): `access = "task"` (the
  default) -- the agents in the same task as the instance; `access = "group"` -- every agent of the instance's group
  (Notes' one notebook). A coordinator agent may use every instance of its group either way. Nothing else gives
  access: an attachment outside a task (once made when an agent used an app another task held) is dropped when the
  group is read, its agent told. The older key `offer` is still read ("always" -> group, "attached" -> task).
- **A group's app is in no task** (decided 2026-11-18): every agent of the group may use it, so a task would mean nothing
  for it. It is never put in one (task_links.py's `taskable`), and one found in a task is taken out as its group is
  read. A task app in no task is used by no actor until it is put in one (the coordinator agent may use it).
- **What adding an app to an actor or a task does, said by the manifest and the user's to change** (decided
  2026-11-19): `on_task` -- "join" (a task app's default: put in the task, its agents attached), "folder" (opened at
  the actor's directory and shown with the task, not put in it: the Files app's) or "no" (not offered: a group app's
  default). It is read where the user adds an app to an actor or a task: "+" on a row, an app's row dropped on another
  (the page), and the server's `POST /api/tasks` add and `POST /api/apps/open` with an actor -- an app that is not
  "join" is not put in a task there. An app starting its own agent is one task with it whatever it says. The user's
  choice, app by app, is set on the Apps page and kept in the dashboard's own <home>/dashboard/app_settings.json
  (`ag_dashboard/app_policy.py`), not config.toml: ag never reads it. A group app can't be made "join".
- **What an agent is given by name when it starts is only what it may use then.** Every tool call -- an app's own,
  `apps_call`, `ag apps call` -- asks access.py again, and the host asks again before its backend (app_host's
  `may_use`); an agent that left a task is refused at once, whatever its tool list says.
- **Which instance:** the one named (`instance`) if the agent may use it; else the one it may use; several, refused,
  each named; none -- a group app's opened for its folder, a task app's refused, saying which tasks hold one and that the
  user puts one in its task.
- **Every agent is told every app installed** (its MCP server's instructions; `ag apps` for a harness without MCP) and
  has five tools for the apps themselves: `apps_list`, `apps_help <app>`, `apps_mine`, `apps_call` (a tool of an app
  it gained after it started) and `dashboard_ls [path]` (the list's folders, tasks, actors and apps, walked like a
  directory; `ag tasks` in a shell). App names `apps` and `dashboard` are taken.
- **Told when its access changes:** an agent gaining or losing an instance through its task, or one renamed, is told
  in its conversation -- a message from the stream "Apps", with an `app_access` record beside it -- before its next
  call (access.py's `settle`, after each change of the tasks or the instances). A group's app never tells: every
  agent may use it always. An app's own messages to its agents name the instance: "Browser · work (<id>)".
- **Opened alone or with an agent:** `[agent] offered` (the older `start`) says an app can be opened with an agent of
  its own. The menus list each app once; which way it opens is the user's choice in its details on the Apps page
  ("Opens": with its own agent, the default, or on its own), kept by the dashboard (`ag_dashboard/app_settings.py`,
  `<home>/dashboard/app_settings.json`) and given with each app in `/api/apps` (`opens_with_agent`).
- **Installing is the user's:** `ag apps install|update|uninstall` run in an agent's shell asks the user, who approves
  or declines it in the dashboard (`ag_dashboard/app_requests.py`); the agent is told the answer. The Apps page, and
  `ag apps` in the user's own terminal, are as before. (An agent calling the dashboard's local API itself is not
  stopped by this: the API has no way to tell an agent's request from the page's.)

### 5. Panels

- **One layout with two kinds of panel.** A tree of splits whose leaves are agent panes `{agent: channel, view}` or
  app panels `{app, instance}`, kept as data and saved. This is the `layout` slice DESIGN.md's step A6 plans. It
  replaces the `panes` object and the Editor's place above the panes. Dragging panels (dockview) can come later.
- **An app panel is an iframe on the app's own origin**, for example `http://browser.localhost:4200`. Browsers send
  `*.localhost` to this machine, so the app's code can't read the dashboard's page or call its `/api`. The iframe is
  never moved, which is rule 4 today.
- **A small SDK talks to the host over postMessage**, `@ag/app` in `app_kit/js/`:

  | Part | Gives the panel |
  |---|---|
  | `events` | `subscribe(filter, cb)`, `insert(events)` |
  | `tools` | `handle(name, fn)` for the tools it handles |
  | `agents` | `attached()`, `attach` / `detach`, `start({harness})` attached, `focus(channel)` |
  | `intents` | `open(intent)`; the intents it handles come in as calls |
  | `links` | `onOpen(cb)`: a link to something in it clicked (5d); `href(path, part)`; `open(href)`: any app's link opened |
  | `selection` | the focused agent pane: its agent, and the turn, call or file selected in it (read-only) |
  | `theme` | light or dark, and the theme's colour tokens |
  | `native` | in the desktop app, a native web view at a rectangle of the panel (`native_view` capability) |
  | `spelling` | in the desktop app, the system's spellchecker (the one underlining words): whether a word is misspelled, its fixes, and one added to the user's dictionary, only as they click |

- **Intents separate agent views from apps.** A view raises an intent and the host sends it to the app that handles
  that kind, opening its panel in the row above the panes:
  - `open-file {path, line, row_id}`
  - `open-url {url}`: from a panel (Paper news's links), a new tab of a Browser shown in the group; none shown, one open
    in no task (no agent's) shown again; none, a new Browser beside the panel
  - `explain-answer {channel, turn}`
  - `use-history {channel, rows}`

  Calls that are made directly today become intents: Chat's file rows into its own viewer, the pane head's Editor
  button, links into the Browser (branch `browser-open-links`), and History's action buttons.
- **The desktop app's native views become a capability.** The preload's Browser stage protocol (`.bw-stage`, CDP
  targets) becomes a general one: a panel asks for a native view at a rectangle, and the host lays it over the
  panel's iframe with today's cover and still-picture handling. Only an app whose manifest asks for `native_view`,
  and that the user allowed, gets one. The preload stays in the dashboard's own frame; app iframes get none.
  `nodeIntegrationInSubFrames` is off by Electron's default today; the app should set it off explicitly.
- **What two apps share is a library, not a call into the other.** The Preview borrows DocWriter's pdf.js and SyncTeX
  today, and the Editor borrows Chat's change renderer. Those move into a library both apps import (in `app_kit/js/`,
  or a package of its own), or into an app of their own: a PDF viewer that handles `open-file` for PDFs.

### 5b. Notifications: an app wanting the user

An app whose manifest asks `notify` (capability) sends the user a NOTIFICATION -- from its backend (`Host.notify`,
`Host.clear_notice`) or its panel (the SDK's `ag.notices.send`, `.clear`, `.onOpen`). It works as an actor's status
does, so the two are one abstraction:

- **Facts, recorded as events.** The host records it in the instance's gatherer: `app_notified` {id, key, title, text,
  show, where}, open until `app_notice_settled` {id or key, how} -- the app cleared it, or the user dismissed it -- as
  an agent's `asked` is open until its `ask_settled`. Its instance closed settles all of its. Records, as the host's
  others: no policy groups them, and no agent is ever shown one (`app_kit/notices.py` checks what one may say).
- **Status, worked out on every read.** The dashboard's home read works out each instance's open ones next to its
  agents' status (data.py's `app_notices`: a gatherer's `apps`), the page told as each is written.
- **Seen, the reader's.** One newer than the reader's last look at the instance -- its panel shown, the page in front
  (seen.py, the item `app:<id>`) -- is NOTIFIED, as an agent done since is FINISHED. The list shows it as a state of
  its own: the app's row's dot, its task's (where it ranks first: after Waiting for you and Error, before Running), the
  counts on gatherer, folder and rail, the rail's tile; and lists them in the app's card, each opening the app where
  it says (`where`, handed to its panel) or dismissed.
- **Said as it happens.** What comes to want the reader -- an app's notification, an actor that comes to wait for them
  or stops on an error -- pops up in the page's corner, unless they have it in front of them; and, the page not in
  front, on the computer too (the browser's Notification, the desktop app's) -- an app's only where it asked: `show`
  "ag" for the pop-up (the default), "system" for the computer's; neither, only listed (a quiet one: a channel's new
  messages, say). The reader turns actors' pop-ups and the computer's off in the settings.

### 5c. Schedules: an app working on its own

An app whose manifest has `[[schedules]]` has its backend called at those times, whether or not anyone has its panel
open: `App.scheduled(name, due)`, `due` the time the run was due (app_kit/schedules.py says when each is; the
dashboard's app_schedules.py runs them). It is the app's, not an instance's: the backend does what it does for each of
its instances (`host.instances()`), as Paper news fetches a day's arXiv listing once and notifies every instance.

- **Due, by the clock on the wall.** Each schedule is looked at every 30 seconds while the dashboard runs, from a
  minute after it starts (its own reads as it starts go first). A run is due
  once its time has passed and it hasn't run since, so a look after the computer wakes, or after the dashboard starts
  again, finds a run it missed, and runs it once, however many it missed (`catch_up`, the default; without, a run more
  than 5 minutes late is skipped). A schedule seen for the first time starts at its next time, never one before.
- **Only for an app someone has open.** A run waits while no gatherer has an instance of the app, and goes once one
  is opened. Every gatherer's records are read once, first, so instances opened before the dashboard started count.
- **Tried again when the backend says so.** `scheduled` returns seconds to try the same run again (what it reads isn't
  out yet, the network is down; 30 s at least), or None when it is done. An exception is tried again 10 minutes later.
  A newer due time takes the place of a run still being tried. One run of a schedule at a time, in a thread of its own.
- **Kept by the dashboard, not as events.** When each schedule last ran, the run waiting and how its last try went are
  in <home>/dashboard/app_schedules.json: a schedule is an app's, in no one gatherer, and the host's records are each a
  gatherer's.
- **Not a way into an agent's context.** A scheduled run reaches the user as any app's work does: a notification
  (5b), its panel told. An app that wants an agent's turn asks for it with `message_agents`: its backend sends an
  attached agent a message (`Host.send_agent`), or starts an agent of its own with one (`Host.start_agent`: attached to
  the instance, in its gatherer, working in the app's own folder unless told another), as Chat sends -- typed into the
  agent's terminal, which is opened if it isn't. A terminal that can't take a message now (a dialog open in it) is
  refused with 409, and the app tries again later. Paper news is the first: each day that comes in, its agent is
  sent the user's interests and the day's papers, and saves its picks with the app's tool.
- **A message sent is not a message answered.** `send_agent` returning says it was typed in, not that a turn took it
  up: typed as the computer went back to sleep, it can be lost (2026-11-13), and a turn can end before the agent
  saves anything. An app that needs the answer looks for it on a schedule of its own and asks again: Paper news's
  "picks" schedule, every 30 minutes, asks for a day's picks again while none came, telling the asks its agent took
  up (it used one of the app's tools after them) from those it never saw, and stopping after a few of the first.

### 5d. Links: an agent pointing the user at something in an app

An agent points the user at something in an app -- a Notes page, a Slack message, a line of a file -- with a LINK in its
reply: markdown, `[the To dos page](ag://notes/page/k3p9x2wq#b8k2)`. The user clicks it, and the app's panel opens
there. The format, `ag://<app>/<path>[?instance=<id>][#<part>]`, is one scheme for every app (app_kit/links.py; the
page's side frontend/src/features/apps/links.ts), not one each: an app's name may be a real scheme too (`slack:`).

- **An app lists the paths it opens** in its manifest's `[[links]]`: each a `form` -- words, `<name>` for one segment,
  a last `<name...>` for the rest of the path -- and what agents are told of it (`about`, which says what #part
  takes). A path of none of its forms is not opened.
- **Agents are told the forms** with the app's instructions, by the host (`Manifest.told`: its instructions, then a
  "Links:" paragraph listing each form): a "group" app's in the MCP server's instructions, to every agent; a "task"
  app's in the own instructions of the agents of a task holding one; any app's in `apps_help`'s answer. An app's tools hand back ready links too (`links.href`): an agent copies one rather than making it,
  and it is what makes an agent link at all -- in a live run (2026-11-18) a small model told only the forms, at the
  end of the instructions, named a page in its reply without linking it, even asked where it was; with notes_add's
  answer saying "link it as [Parser plan](ag://notes/page/...)", it linked it.
- **Chat draws one** as a link with the app's mark before its words (core/ui/md.ts lets `ag://` through DOMPurify; any
  other scheme but the web's is still dropped). Other places drawing an agent's markdown do the same.
- **A click opens it** (src/features/layout/panes.js's `openAppLink`), the link checked against the app's forms. THE
  INSTANCE, the first of: the one the link names; one of the writing agent's task (attached to it: the one shown, of
  several); one of the app's whose panel is shown; one open in the group -- one that opens here (in no task, or in
  this one) before one of another task, and of those one on the agent's folder first; else the group's for that
  folder from the server, which opens one only where there is none to be had (a new one in no task). An app with
  many instances (the Editor) is so reused before another is made. WHERE: its panel shown, it is selected there; an
  instance of another task, that task is shown, as a click on the app's row (or on a notification of the app's) shows
  it; else its panel opens above what is shown. Then the panel is handed the link -- `{href, path, part, values,
  form}`, the SDK's `ag.links.onOpen` -- and goes there. Any key held, the same: never the browser's to open.
- **A file's path is a link too.** Agents write paths without being told any form -- `[parser.py](src/parser.py#L12)`,
  `/work/plan.md:7`, `file:///work/plan.md` -- and a browser would open one as a page of the dashboard's own site.
  Chat marks one (core/ui/md.ts's `data-path`, `file://` let through DOMPurify; a link the dashboard draws itself, as
  `/api/image?…`, isn't marked), and a click on it, or on a `file://` link a terminal shows, opens it
  (`openFileLink`) as the link of the form `file/<path...>` (links.ts's FILE_FORM) in an app whose `[[links]]` take
  that form -- the one whose form says `paths = true` (the Files app's, 2026-11-18: "for references to files in chat
  ... it will open in the file viewer app"), else of several the one the agent has, else the first installed. A
  relative path is from the agent's folder; `#L12` or a last `:12` is the line.
- **A click is only the user looking.** It calls no tool, attaches no agent and is no event: what the agent sees
  doesn't change. The panel treats the path as untrusted, as it would one the user typed.
- **Between apps too.** A panel opens any app's link as Chat does (`ag.links.open(href)`), so a Notes line can link
  to a Slack thread.

### 6. What moves out of the agent views

| Piece | Becomes | How the agent view reaches it |
|---|---|---|
| Files-and-commands panel (Chat's left side) | Stays in Chat: a way of looking at the agent's own history, not an app the user works with | — |
| File viewer (Chat's file pane) | Stays in Chat, as the panel does; opening the file itself to edit is the Editor's | `open-file` |
| Background tasks list | Stays in the agent view: the tasks are the agent's | — |
| Question and plan-approval card, errors | Stay: the harness asks, and the agent waits | — |
| `/context`, Details, Messages, Transcript | Stay: views of the agent | — |
| History's Summarize / Generate skill / memory / AGENTS.md, Save to..., Export | **Skills & memory** app; the skill watcher joins it later (deferred: stays in History for now, 2026-11-07) | History keeps its tree and selection. A selection raises `use-history` |
| Editor (above the panes) | **Editor** app, one instance per folder | `open-file`; the pane head's button opens the agent's folder |
| Preview (inside the Editor) | **Preview** app, one instance per checkout; `ag preview` becomes its tools | Opened beside the Editor, or by `open-file` on what it builds |
| Browser pane view | **Browser** app, instances and attachments | `open-url`; the panel sits beside its agents' panes |
| DocWriter pane view | **DocWriter** app, one instance per document | Its panel; its agents attach |
| Answer sources (unmerged) | **Sources** app, with its own model call | `explain-answer` from a turn |
| Branches (an actor's own worktree, merged by the dashboard) | Stays with agents: it is how an actor is started. What it shows in the Editor reaches the Editor app as events | — |

"Ask on the side" isn't anywhere in the code yet. Under this design it is an agent, not an app: a new agent started
from a turn's context, shown in an agent pane.

### 7. Where the code goes

```
app_kit/                  the contract, on ag's (ag.ag_interface): standard library besides; nothing of the dashboard
  manifest.py             Manifest, ToolDef, EventDef, the capabilities; reads app.toml
  backend.py              App, Host, Instance, Caller, ToolResult
  remote.py               the same calls over HTTP, for an app in its own process
  js/                     @ag/app: the panel SDK and its types
ag_apps/                  our apps, each a folder with an app.toml, built as an outside app would be
  preview/  editor/  browser/  docwriter/  skills/  sources/
ag/                       knows an app only as event types and pollers
  ag_harness/home/        [apps] removed in config.toml (ag's own apps uninstalled); every app found is on everywhere
ag_dashboard/             the host: no app's name in its code
  app_host.py             reads manifests, runs backends, keeps attachments
  tool_gateway.py         /mcp/<channel>; `ag apps call`
  api/apps.py             /api/apps; events read, subscribe and insert; panel files; the apps' own routes
frontend/src/
  layout/                 the layout tree: agent panes and app panels
  features/panels/        AppPanel: the iframe and the SDK's host side; intents and selection
desktop/                  the native-view capability, with no app named in it
```

**Rules**, checked in CI:

1. `ag_dashboard/`, `frontend/src/{core,layout,features}` and `desktop/` name no app (`test_apps_untouched.py`, like
   `test_harness_untouched.py`). This replaces today's rule 3, which lets `apps.py` and the apps' modules name them.
2. An app imports `app_kit` and nothing of `ag_dashboard`. Our apps keep to this too, so they test the contract.
3. `app_kit` imports the standard library and ag's contract, `ag.ag_interface`, and nothing else of `ag`.
   An app's event types are ag `EventType`s, its pollers ag `Poller`s, and what it inserts is ag's insert shape:
   ag's policies, pollers and store are used as they are, with no second kind of event.
4. ag's policies never learn an app's types. Apps reach agents only through `context_stream` and
   `environment_update`.

### 8. Apps from outside

- **Installed is on, everywhere** (decided 2026-11-17). An app found is installed, and on in every group: its panel
  opens anywhere, an agent gets its tools when its terminal next starts (those its `access` gives it, 4b), and every
  gatherer runs its pollers. There is no turning an app off in a group: `gatherer.toml`'s `apps` is no longer read.
- **Install** (built: `app_kit/installing.py`): from a folder or a git URL (pip packages later), the app is staged --
  copied into `<home>/apps/.incoming/<id>` (a git URL cloned at its newest commit, its history dropped) -- and its
  app.toml checked as `load` checks it; a bad one is removed again, with why. Installing moves it to
  `<home>/apps/<name>/`, beside the `data/` it may have there from before, with where it came from
  (`.ag-installed.json`: git or folder, the source, the commit). Refused: a name already installed (Update instead),
  and a name of an app that comes with ag (one of AG_APPS_PATH overrides that instead).
- **Update** (an app from git): its source staged again; what changes for the user (tools added and gone, what it may
  do that it couldn't) said first; then its folder is replaced in place, its `data/` kept.
- **Uninstall:** one installed in `<home>/apps`, its folder removed but its `data/` (unless asked); one that comes
  with ag, named in config.toml's `[apps] removed` (which `finding` skips) and so listed to install again; one of
  AG_APPS_PATH's is removed there. Its windows close, its backend stops, an agent's call of its tool is refused at once
  (saying why) and its tools leave the agent's list when its terminal next starts; its windows' records stay, so
  installed again it finds them as they were.
- **Where:** the dashboard's Apps page (`ag_dashboard/app_catalog.py`, `api/app_catalog.py`; the page's
  `features/apps/catalog.ts`), a screen tab of its own, from the settings panel and a new tab's "Apps…": every app
  installed with what it gives agents and costs them (≈ tokens: its tools' definitions and its instructions), what
  it may do, its windows and its data; the apps to install (ag's index, `ag_apps/index.toml`, empty for now, and
  ag's own uninstalled); the folders that couldn't load. `ag apps install | uninstall | update | list --all` do the
  same from a shell, asking first unless `--yes`.
- **Permissions:** the manifest lists them, and they're shown at install:
  - event types it reads besides its own (for example `tool_call` of its agents);
  - `native_view`;
  - reading files in its agents' folders;
  - running commands.

  The host enforces what passes through it: reads and inserts of events, tool routing, native views, the panel's
  origin. A backend in its own process isn't sandboxed by ag. Installing one trusts it, as installing a VS Code
  extension does, and the install says so.
- **Custom chat views** (`agDashboard.chatView`) stay. They are views of an agent, not apps.
- **A store** is then an index of manifests and where to get each one. Not part of this plan.

## Order of work

Each step is one PR and leaves the dashboard working. Steps 1–3 change nothing the user sees.

1. **`app_kit`.** Manifest, `App`, `Host`, the remote protocol and their tests. No app uses it yet.
2. **The host.** Built:
   - `ag_dashboard/app_host.py` finds apps (`ag_apps/`, the apps that come with ag; `AG_APPS_PATH`, `<home>/apps/`), runs their
     backends (imported from their folder, or started as a process), and keeps instances and attachments as the
     host's records (`app_opened`, `app_named` -- what the user called it --, `app_closed`, `app_attached`, `app_detached`,
     `app_call`). A gatherer's are read
     once, the first time it is asked about.
   - `api/apps.py`: the page's routes (`/api/apps`, open, close, rename, attach, detach, events, insert, call, a stream), an
     app in its own process reaching the host with its token (`/apps/host/<name>/<op>`), and each app's own origin
     (`Origins`, outermost): its panel's files and its backend's `/api/`, and none of the dashboard's routes or its
     WebSocket.
   - Inserts go through `ag home insert`, which now takes `--types`: an app's event types declared first with ag's
     own `add_event_type`, so their `required` and `identifies` flags hold. The host checks each insert against the
     manifest and sets `app`, `instance` and `channel` itself. Context events are checked against the shapes ag's
     policy reads (`app_kit/events.py`), and a test shows one reaching the attached agent's context through
     `proactive_context_manager`, unchanged, and not reaching another agent.
   - The dashboard's conversation views leave the apps' records out (`data.NOT_RECORD`: the host's types and any
     dotted `<app>.<what>` name).
   - The dashboard imports nothing of ag directly; through `app_kit` it has ag's contract (`ag.ag_interface`), not
     its runtime.
3. **The tool gateway.** Built:
   - `ag_dashboard/tool_gateway.py`: the apps on for a gatherer (every app installed: see 8), their tools as MCP
     lists them, their instructions, and each call resolved to an instance.
   - `POST /mcp/<actor>`, one MCP server per actor (the id it started under, so a codex session keeps it once its
     thread has its own), given to every session at launch whose harness takes one, when any app is on; a session's
     first message waits for it to have listed its tools, as for the app actors' servers now.
   - `ag apps [list]` and `ag apps call <app>_<tool> '<json>'`, through `/api/apps/agent` and `/agent/call`.
   - A tool its panel answers is sent to the instance's open panels as a message and waited for (30 s for a panel,
     120 s for its answer), as DocWriter's are now; the panel answers with `POST /api/apps/answer`.
   - An app's `[[pollers]]` are entries of ag's own catalog, `<app>.<name>` (`Home.pollers`, through app_kit's
     `finding`, so ag and the dashboard find the same apps). Every gatherer runs every installed app's pollers
     (once, if its `pollers` names one too); ag builds and checks each as any poller.
   - The Browser's and DocWriter's own endpoints stay until step 8; their actors are given those, not the gateway.
4. **App panels** (front end). Built, one change from the plan: app panes join the page's panes as they are (one
   more kind beside the actors', `features/layout/panes.js`), and the layout tree waits; rebuilding the panes as a tree now would
   rewrite them under every other change to the page. Changed after step 5 (2026-11-07, its own PR): an app's panel
   is in the row above the panes (`#top-row`), beside the Editor, sharing its height; each panel's width its share
   (a bar before it); opening one shows the actor attached to it below, in the pane in focus (one open already: its
   pane focused); kept in this browser under `ag-dashboard-top-apps`.
   - The SDK, `app_kit/js/app.js`, served on every app's origin at `/_ag/app.js`: events (read, subscribe, insert),
     tools (answer, call), agents, intents, the selection, the theme (its colours set on the panel's `:root`), the
     backend's messages, its own `/api/`; Esc and ⌘/Ctrl keys it leaves unhandled go on to the page. A request the
     page doesn't answer fails after a wait longer than the page's own for it (30 s; `tools.call` 3 min, over
     app_host's 30 s + 120 s for a tool a panel answers; starting or messaging an actor 1 min): a page reloaded or gone
     between a request and its answer never answers it, and a panel would wait on it for good.
   - The kit, served on every app's origin at `/_ag/lib/` (`ag_dashboard/libs.py`): `kit.js` (`agKit`: `el`,
     `patch`, `ago`) and `kit.css`, the theme's colours -- every one the host hands a panel (`theme-vars.ts`), light
     and, under `:root[data-ag-theme="dark"]`, dark, with the dashboard's values (`theme-vars.test.ts` keeps them the
     same as `base.css`'s). Each panel links it before its own stylesheets and reads `var(--ink)` with no fallback of
     its own, so it is drawn in the theme's colours before the host's arrive too. DocWriter, built from its own
     sources with its own palette, doesn't.
   - The page's side, `frontend/src/features/apps/host.ts`: an app's pane -- its frame, with no head over it, and a
     small × over its top right corner that closes the panel (the app left open); the panel keeps that corner clear,
     its bars along the top padded at their right by `var(--ag-corner)`, which the SDK sets. Its row in the list (or in
     its task's card) names it, closes it and puts agents in its task, and right-clicked, moves its panel or closes it
     (features/layout/panes.js's `appPanelMenu`) -- and the bridge to its frame, which checks every message's source and origin. A panel has one stream for its backend's messages, a tool call among them, and one per
     subscription; an intent for a panel not yet connected waits for it.
   - Apps are opened from a gatherer's "+ ⋯" menu, beside the pane in focus, the actor in focus attached. An app's
     pane is kept with the page's panes and opened again on a reload, if its instance is still open.
   - Intents: a panel's `intents.open` opens the app that takes it (for `open-file`, by the file's media type), in
     the instance for the file's folder, and tells its panel. The agent views raising them comes with step 6.
   - The selection: the actor in the actor's pane in focus last, told to every panel as it changes.
   - The test app, Notepad (`tests/apps/notepad/`), uses each part, and `frontend/e2e/apps.spec.ts` drives it; the e2e
     dashboard finds it (`AG_APPS_PATH`) and inserts through this checkout's `ag` (`AG_COMMAND`).
5. **Preview, the first real app.** Built, as one change, so there is never a second preview beside the first:
   - The apps that come with ag are a package, `ag_apps/` (found through Python's imports, so a wheel carries them).
     Preview is `ag_apps/preview/`: its run logic (`runs.py`, ported from `ag_dashboard/preview.py`, which is gone,
     with its routes and table), its backend (`backend.py`), its panel (`panel/`, ported from the Editor's preview
     side).
   - What it keeps is its events: `preview.set`, `preview.allowed`, `preview.cleared`, `preview.ran`. One instance
     per repository (`per-repository`, new in app_kit: worktrees share it), each worktree's runs its own.
   - Who may run what is as before: the user anything, an agent only a command the user set or let run. Letting one
     run is the user's alone: a call passing the command as `ok` from an agent is refused.
   - Its tools are `preview_show`, `_set`, `_run`, `_stop`, `_clear`; `ag preview` is now a client of them.
   - The Editor asks for it by intents (new in app_kit): Execute and ⌘↵ raise `run`; "→ PDF" and a double-click in a
     TeX source raise `locate`. The panel sends a PDF's place back as `open-file`, which, with no app taking it, the
     page gives the Editor.
   - What two apps share is a library the host serves on each app's origin (`/_ag/lib/`, `ag_dashboard/libs.py`):
     pdf.js (with SyncTeX in the panel), marked and DOMPurify. The Editor's own PDF viewer keeps `/vendor/pdfjs/`, the
     same copy.
   - `Caller.folder` (the agent's working folder) and `Host.panels(instance)` are new in app_kit: an agent's preview
     runs in its own checkout, and a server no panel shows is stopped.
   - Checked live: a Claude Code session (Haiku) started by a scratch dashboard was given the gateway at launch, and
     set and read the preview with its tools.
   - Not carried over: previews set before this (the old `previews` table) start again from a guess; `ag preview`
     from a shell that is not an actor's is refused (it was "a shell's" before).
6. **Activity: dropped** (2026-11-07). The files-and-commands panel and the file viewer stay in Chat: they are a way
   of looking at the agent's history, not an app the user works with. The Editor's changes panel keeps using Chat's
   code until the Editor's step.
7. **The Editor.** Its tree, live editing, conflicts and viewers become the Editor app; it takes `open-file`. Its
   panel replaces the area above the panes. The whole Editor is to be an app, not only its preview (2026-11-07).
   Taken up 2026-11-08, as asked: it looks as it did; the Preview is part of it, not an app of its own; and agents
   work with it as they do with DocWriter, through tools of its own, an edit landing as one of several modes the user
   picks. Two PRs:

   **(a) The Editor as an app: built** (2026-11-08). Set up and used as the Browser and DocWriter are (the user,
   2026-11-08: "the editor should be setup and used exactly like a browser, docwriter"): started from a gatherer's
   "+ ⋯" menu on a folder, with an actor of its own attached (`[agent] start`, "Editor · {folder}", its `mark` on the
   actor's avatar); one per Editor started (`instances = "many"`); its tools and instructions its attached actors'
   (`access = "task"`); its panel in the top row under the head the dashboard draws over every app's. No button
   of its own on an actor's pane. It still takes `open-file` (an app naming the file's type first): an Editor open in
   the top row is told, rather than another opened.
   `ag_apps/editor/`: `app.toml`, `backend.py` (its panel's routes, the Preview's tools and runs: `runs.py`, moved
   from `ag_apps/preview/`, which is gone), `chooser.py` (the system's Open dialog, moved from the dashboard), `panel/`
   (the dashboard's `legacy/18-editor*.js` and their CSS, moved as they were, beside `page.js`: the page's helpers they
   used, small, and the SDK in place of the page's state; `preview.js`: the Preview app's panel as a column beside the
   file; `vendor/editor.js`: CodeMirror, Yjs and now the dashboard's highlighter, built by `assets/src/editor`). Each
   project's preview kept by its repository and shared by the gatherer's Editors (`editor.preview_set`, `_allowed`,
   `_cleared`, `_ran`, each with its `key`); its tools `editor_preview_show`, `_set`, `_run`, `_stop`, `_clear` --
   `ag preview` a client of them, for an actor attached to an Editor.
   - **The files it edits stay the host's** (found while building it): `editor.py`'s live documents -- the merge,
     the conflict zone, saving, who changed which file -- are what the actors' branches merge into (`branches.py`
     raises its conflicts and marks in them) and what `ag actors who` reads (`coordination.py`). Moved into the app,
     branches would be cut off from the files open. So they stay in the dashboard, as `livedocs.py` (renamed; no
     app's name in it), and an app reaches them through the contract: capability `docs` and `Host.docs()`
     (`app_kit/docs.py`, the dashboard's `app_docs.py`), for an app run in the host's process. Another app with files
     to edit live (DocWriter, a PowerPoint app) can use the same documents, and the same concurrency control.
   - **What else the contract gained**, each general: capability `actors` (the SDK's `ag.actors`: the actors as the
     list shows them, their names, avatars, hues, folders, status -- the Editor's marks and tree); `ag.folder` (the
     instance's folder, to its panel); `Response.file_at` (a file served in ranges: a video, a PDF); `_here` in a
     request's query (a dialog the app opens shows on the host's machine); an intent's handler, one naming the file's
     type first.
   - **The page**: its Editor is gone (`18-editor*.js`, `#ed-top`), with the actor's Editor button and what only it
     used (`/api/files/place`, `files.lately_changed`); `features/layout/top.js` keeps what is the page's -- the top row's grip, the
     chat minimized under the row -- for any panel there.
   - Checked: the Python suite and the browser tests (`e2e/editor.spec.ts`, in place of `preview.spec.ts`: an Editor
     started from the menu; a file opened by `open-file`, typed into and saved; Execute and the preview beside it; a
     LaTeX build and SyncTeX both ways); live on a scratch dashboard beside `main`'s.
   - Not carried over: the Editor's shown-or-not (`ag-dashboard-editor`); opening it at an actor's folder from the
     actor's pane (the user had it removed); ⌘P from outside the Editor (the page's) -- inside it, as before;
     `ag preview` from an actor not attached to an Editor.

   **(b) Agents work with it, DocWriter's way: built** (2026-11-08). Its agents change files with its tools, and the
   user picks how their changes land.
   - **Tools** (`editor_read`, `editor_edit`, `editor_write`, `editor_open`): `editor_edit` is Claude Code's Edit
     (old_string, unique unless replace_all), `editor_read` numbers its lines as Read does. A file no Editor has open
     is read and written on disk, whatever the mode; one open is changed through the host's live document.
   - **Modes**, one per Editor, picked in its head ("Agents: Live / Review / Hands off"), kept as `editor.mode`
     events; a file open in two Editors takes the strictest. Live: the change lands at once, in the agent's hue
     (the document's `marks`), and is written to the file -- its lines only, what the user typed and did not save
     left unsaved; one to the conflict zone's lines is held in a box. Review: each change a proposal in place
     (Accept / Reject / Keep both / Edit, and Accept all / Reject all in the head), the file on disk unchanged until
     accepted; the agent reads the file with its own proposals in, its next change building on them (one proposal per
     place). It never waits on one (the user, 2026-11-08: "propose and move on"): its tool answers at once, it is told
     to carry on with its task, and what the user chose reaches it whenever they choose. Hands off: refused, "ask the
     user first".
   - **Writes around the tools** (a shell command, Codex's or Antigravity's own edits, an agent not attached, a sync
     such as Dropbox's or Overleaf's): merged in, in every mode, except to the conflict zone's lines, which become a
     conflict box (the user, 2026-11-24: "just merge in changes on disk except for the conflict zone"). Until then
     Review and Hands off asked about each one (`Conflict.asked`), so a paper synced from Overleaf asked about every
     co-author's edit. The docs' "ask" hold is still there for an app that wants it; FileEdit no longer uses it.
   - **The guard**: Claude Code's own Edit and Write on a file open in an Editor refused (the existing `edit_guard`
     capability), pointing at `editor_edit` -- for an agent attached to an Editor, which has its tools.
   - **Told**: the agent whose change was held, what the user chose (a `context_stream` message in its channel);
     agents that used the tools, when the mode changes (one that never started would otherwise be listed as having a
     conversation).
   - **The contract** (`app_kit.docs`), each general: `open(..., hold)` and `hold(...)` ("merge" or "ask": how a page
     takes the file's changes on disk); `state`; `view(path, root, channel)` (the text with an actor's proposals in);
     `put(path, root, seen, wanted, by, how)` (an actor's change, "live" or "propose", merged onto what changed since it
     read). A conflict's `agent` now also marks a change put in (`put`, `why`: "approve" or "zone"). A branch's held
     changes are unchanged; settling routes to the branches only for those (`branch`).
   - Not done: telling the actor below the Editor which file is open and what is selected when the user messages it
     (decision 4); Codex and Antigravity can't be stopped from editing open files (no edit hook) -- their writes are
     merged or asked about as above.

   **(c) Lines selected, sent to an actor: built** (2026-11-13). The user: "select a part of text and then after I
   select it send to an actor ... as if I had manually switched to that actor and sent a message". Text selected in
   the file open shows a button beside the selection's end ("Send to an actor"; not while the mouse is still
   selecting); it opens a picker over the Editor: a box for what to do (it has the keys), then the actors of the
   Editor's gatherer (not closed ones, but saved ones; the coordinator agent first, if there is one). The one picked
   gets, as the user's own message (capability `message_actors`, `ag.actors.send`, as Chat sends): the user's words,
   then "Lines 3-7 of /the/file's/path:" and the selected text in a fenced block (its extension as the language). Over
   20,000 characters: only where the lines are. An auto-saved file is saved first, so what the actor reads there is
   what was quoted; otherwise the message says the lines are not saved yet. No `[asked]` note, no report back, no
   status: it is a message like any other, in its Chat. `panel/editor-send.js`; `e2e/editor.spec.ts`.
   - Not done: a new actor started from the picker (as Notes offers); a key for it.

   **(d) Split into the Files app and the LaTeX editor** (2026-11-18). The user: "split editor app into (1) files app
   (which is a generic file opener/directory viewer) and (2) a latex editor app which has the latex functionality and
   also the preview button". Two apps, each set up as the Editor was (started from "+ ⋯" with an actor of its own,
   `offer = "attached"`, `instances = "many"`), sharing what they both do as a library, not one of them the other's:
   - **`app_kit/fileedit/`**: the file editing -- `FileEdit` (backend.py: the panel's edit/..., mode, branches and
     files/changes requests, the mode, the file tools `<app>_read/_edit/_write/_open`, the guard, the agent told what
     the user settled), `chooser.py`, and `panel/` (page.js, editor*.js, recent.js, plain.js, start.js, the CSS,
     vendor/editor.js), served to every app's panel at `/_ag/lib/fileedit/` (the dashboard's libs.py). Its `.js` are ES
     modules, imported by the app's own (its panel's one `<script type="module">`, after the kit and the SDK, which they
     read as globals): the app's module adds its parts with `edAdd` (editor.js) -- header buttons, a column beside the
     file, keys, CodeMirror extensions, bold/italic markup, its backend's messages, plain editing -- then starts the
     panel (start.js's `edStart`). Only the app's module, which loads last, uses another as it loads; what the others
     set up runs when the panel starts, so their import cycles load in any order (2026-11-19). Which files are open, and
     as what mode, is one registry for every app built on it: a file's mode is the strictest of all that have it open,
     and a change put in through one is settled in any.
   - **Files** (`ag_apps/files/`): FileEdit, edited **plain** (the user, 2026-11-18: "just a regular viewer (i.e., no
     support for accepting/reviewing agent edit), or considering for concurrency of conflicts", then "You can do
     non-read-only"). A text file is read whole (`edit/text`: text and version), edited in the page alone, and saved
     whole (`edit/put`) by Save, ⌘S or Auto-save. Changed on disk with nothing unsaved, it is read again; with edits
     unsaved, the reader picks Reload or Keep mine, and no save goes over the change until then (409). It has no live
     document, mode, conflict zone or branch approvals (`panel/plain.js`'s part, which its panel gives to `edAdd` as
     `plain`; the LaTeX editor's never loads it). Its agents edit with their own tools; their one tool is `files_open`.
     `access = "group"` (any actor of the group may show the user a file in it), `offered = false` (it opens alone). It
     takes `open-file` for any file.
   - **LaTeX** (`ag_apps/latex/`, tools `latex_*`, events `latex.mode`, `latex.preview_*`): FileEdit plus the
     Editor's preview (runs.py, texlog.py: Execute, the PDF, SyncTeX, Problems) and its LaTeX parts (latex.js:
     "→ PDF", the problems' marks, ⌘B/⌘I in LaTeX). The command can still be any; the guess for a .tex is latexmk.
     It takes `open-file` for `text/x-tex` and `text/x-bibtex`. `ag preview` is a client of its tools.
   - **What actors changed lately**, in both apps (`panel/recent.js`): a window picked over the tree (10 min, 30 min,
     1 h, 4 h; 30 min unless picked, kept per instance) is what the tree's avatars (the listing's `since`), the
     header's and the file's marks show. The lines an actor changed are found in the file as it is now from what ag
     recorded of its edits (`/api/files/changes`: a diff's new lines, a Write's text) and marked with a bar in its hue,
     with its avatar after the first. A shell command's change has no recorded lines; deletions show only in the
     header's Changes list. Any avatar pressed opens its actor as its row in the list does (`ag.actors.show`).
   - **An actor started from the tree**: its menu's "Start an actor here…" (a folder) or "… on this file…" (a file,
     its path put first in the box) asks for a harness and what to do, and starts it in that folder
     (`ag.actors.start`), then opens it.
   - **Links to files** (5d): both take `file/<path...>`, the Editor's form -- `ag://files/file/...`,
     `ag://latex/file/...` -- each its own (`start.js`'s `ag.links.onOpen` -> `edShowFile`). A file's path an agent
     writes with no app named (`[a.py](src/a.py#L3)`, `file://`, a terminal's path) opens in the Files app: its form says
     `paths = true` (links.py: allowed on FILE_FORM only), which the page's `openFileLink` takes before any app the
     actor has open. Every agent of the group is told the Files app's form (a group app); an agent of a LaTeX editor,
     its form too, to open a file in that editor.
   - **Which opens a file**: the page asks the apps that take it in order (those naming its type, then those taking
     any) and tells the first with a panel open; with none open, it opens the first. So a LaTeX source goes to a
     LaTeX editor open, else a Files app open, else a new LaTeX editor; any other file to the Files app.
   - **The Editors open before** (new in app_kit: a manifest's `replaces`, `App.takes_over`): an instance of an app
     no longer found is taken over by an app that replaces it -- the one that wants it most -- kept as its own under
     the same id (`app_opened` by "replaced"), so its agents stay attached and its name, task and group are kept;
     its actors' roles are moved with it (app_agents.py's `adopt_all`). Both replace "editor": the LaTeX editor
     wants one on a folder with a LaTeX source at its top, the Files app any other. One taken by an app of access
     "group" (the Files app) leaves the task the Editor was in -- an app every agent of the group may use is in no task
     (the user, 2026-11-18) -- as its group is read (task_links.py's `on_load`, as any group app found in a task); one taken by the LaTeX
     editor (access "task") stays in it. Not carried over: a preview set
     in an Editor (its events are `editor.*`, which no app now reads; the guess comes back), and what a browser kept
     of an Editor's panel (its folder, its file open: kept on the Editor's origin).
   - Checked: test_app_latex.py (the Editor's tests, as the LaTeX editor's; a file open in both apps),
     test_app_files.py (the two manifests, the takeover), test_dashboard_editor*.py (through the Files app);
     `e2e/editor*.spec.ts` (each test on the app it is about; a LaTeX source routed as above).
8. **The Browser and DocWriter.** What they do for the user and the agent today is kept (2026-11-07): only where
   their panel sits and how they plug in change. DocWriter first, then the Browser, each its own PR.
   - Each becomes instances (the instance id is its key today, so its profile, logins and saved tabs stay where they
     are) and attachments, with its tools through the gateway. A stored role (`{"browser": key}`) is copied to an
     `app_attached` once, here: until then they aren't apps the host knows.
   - Its panel is in the row above the panes, its actor's Chat and Terminal below: the `browser` and `docwriter` pane
     views go, and the per-app MCP endpoints with them. "+ Browser" / "+ DocWriter" still make one and a new actor
     attached to it.
   - What the agent is told of the app reaches it as ag's events, not by the dashboard rewriting the user's message:
     the app inserts them, or gives an ag poller that pulls its state before each model call of an attached agent.
     The Browser's `<browser_state>` (the page, what the user did since, what they picked) becomes events it inserts
     into its agent's channel (below: a poller's would reach every session): the same content, now also between the
     calls of a turn. DocWriter's page-built prompt stays the message its page sends.
   - DocWriter's guard on the harness's own edit tools becomes a capability an app declares (the host adds the hook).
   - DocWriter's own request box stays: its page messages its attached agent through the SDK, as it sends today
     (`message_agents` capability), the prompt it builds as it builds it.
   - The desktop app's native view becomes the capability: the panel says where its screen is, the page tells the
     desktop app.

   **DocWriter: built** (2026-11-07, its own PR). `ag_apps/docwriter/`: `core.py` is the dashboard's `docwriter.py`
   moved as it was (documents, tabs, files, hooks, previews, SyncTeX), `backend.py` the App over it, `panel/` its page
   built from upstream against the panel SDK (assets/src/docwriter, `npm run build`, which also writes `tools.json`
   and `instructions.md` and the dashboard's shared pdf.js at `ag_dashboard/vendor/pdfjs/`). The dashboard names it
   nowhere: its `docwriter.py`, `api/docwriter.py`, `vendor/docwriter/` and the page's DocWriter view are gone. What
   the contract gained for it, each general:
   - manifest: `access = "task"`, then `offer = "attached"` (its tools and instructions only for an agent in its task: its instructions
     as the agent's own, `instruction_args`, as before), `[agent] start` (the menu starts one with a new actor:
     app_agents.py, `/api/apps/start`, and `ag actors new --docwriter`), `tools_file` (tools a build writes), `mark`
     (the badge on its actor's avatar, served at `/apps/mark/<name>.svg`), `[asked]` (what the list shows of a
     message the app's page wrote); capabilities `message_agents` (send, answer a question, Esc), `transcript` (the
     agent's turn as Transcript has it), `edit_guard` (App.guard: the harness's hook, `ag_dashboard/app_guard.py`, asks
     `/api/apps/guard`)
   - the SDK: `agents.state` / `onState`, `send`, `answer`, `interrupt`, `transcript`
   - a panel's request may name its instance in its path (`/api/w/<gatherer>/<instance>/...`), for URLs it can't add a
     query to (its preview page, an image)
   - the page holds a panel out of sight while an attached agent is at work, for an app whose panel answers its tools
     (as DocWriter's frame was), and selecting an app's actor opens its app's panel above it
   - adoption: an actor whose stored role is `{"<app>": key}` of an app the host now finds is attached to that app's
     instance of that key (app_host.py's `adopt`, at the dashboard's start); the app copies what it kept in
     dashboard.db once (DocWriter: `docwriter_docs`, `docwriter_kv`, left in place)
   Checked live: a Claude Code (Haiku) actor started with a DocWriter had its six tools; `docwriter_read_doc` was
   answered by the panel; its own Edit of a document open in DocWriter was refused with DocWriter's reason.

   **The Browser: built** (2026-11-07, its own PR). `ag_apps/browser/`: `core.py` is the dashboard's `browser.py`
   moved as it was (the Chrome, the tools and their checks, the user's input, picks, the screen as video:
   `video.py`), `backend.py` the App over it, `panel/` the dashboard's Browser view (`20-browser.js`, its CSS) moved
   onto the SDK, `make.py` writes `tools.json` and `instructions.md` from the core. The dashboard names no app at all
   now (`test_dashboard_apps.py`): `apps.py` -- the old way an app was built into the dashboard -- is gone with
   `browser.py`, `browser_video.py`, `api/browser.py` and the Browser view; Settings' "Import logins" is the panel's
   own "⋯" menu. Its 14 actors are adopted as DocWriter's were, and its tabs copied from dashboard.db once; its Chrome's
   profile, downloads and the desktop app's marks stay in `<home>/dashboard/`, where they were.
   - **What the user does reaches its agent as ag's events, inserted, not a poller.** A poller's events belong to no
     channel (every session in the gatherer would see one Browser's clicks), so the Browser inserts a `context_stream`
     ("Browser", "the user") into each attached agent's channel: what the user did, the page, what they picked --
     `<browser_state>`'s content -- `TELL_AFTER` (2 s) after they last did something, at once on a pick. Its agent
     sees it at its next model call, also between the calls of a turn, where `<browser_state>` waited for the user's
     next message. An action's result still says what the user did meanwhile, unless told already.
   - **The user's next message to its agent** (read as `user_message`: a `reads` capability) puts their picks away and
     lifts a stop (Esc), as sending one did: looked for on each tool call and every 3 s while a Browser waits on one.
   - **`Response.stream`**: a backend run in the dashboard may answer its panel with server-sent events (the screen).
     Panel requests' bodies are capped at 40 MB (413).
   - **The native view is `native_view`**, for an app run in the dashboard. The panel says where its screen is
     (`ag.native.show(el, target)`, each frame, covered by the panel's own menus or not); the page offsets it by the
     frame, checks the dashboard's own overlays over it (`features/apps/native.ts`), and tells the desktop app
     (`agApp.place`), whose preload no longer scans the page. A still picture goes desktop app → page → panel, its
     "drawn" back the same way. The desktop link (`/api/desktop`, `desktop.py`'s token) is the host's: it hands it to
     each app that asks (`App.native`), every message tagged with its app; the desktop app keeps each app's pages
     apart (seen, driven and placed only by it) and in a profile of its own -- the Browser's the one it always had
     (`persist:browsers`), so its logins stay.
   - Clicking an app's actor that is already shown opens its app's panel again, if closed.
9. **Skills & memory, and Sources.** History's actions move to Skills & memory. Sources becomes an app once it is
   merged. Deferred for now (2026-11-07): History keeps its Summarize, Generate skill / memory / AGENTS.md, Save to
   and Export as they are, until this step is taken up.
10. **Apps from outside.** `ag apps install`, the permissions shown at install, and the store's manifest format.
    Skipped for now (2026-11-07). Proposed when taken up: install from a folder or git URL into
    `<home>/apps/<name>/app/` (data kept in `data/`), permissions shown and confirmed, off until turned on, run in a
    process of its own, `update` / `remove`, loaded without a restart; `native_view` unavailable to it (as in a
    browser tab) until the desktop link can be passed to an app's own process.

**Notes**, a new app (2026-11-08), not a move: a notebook per gatherer (`ag_apps/notes/`, instances `one`), pages
and subpages of blocks (text, headings, to-dos, lists, quotes, code, dividers), a minimal Notion. It is kept in a file
of the app's data folder (`<home>/apps/notes/data/<gatherer>.json`), not as events: each keystroke's change would be
an `ag home insert`, and a gatherer with no database yet holds its writes. The panel and the agents change it by the
same ops (`notebook.py`), one batch at a time; the backend tells every open panel each batch, numbered, in order.
Agents get `notes_read`, `notes_add` and `notes_change` (`access = "group"`), and read and write pages as markdown with
each block's id. The test app it took the name of is now Notepad (`tests/apps/notepad/`). An app's mark now shows
on its "+ ⋯" menu entry too.
The pages' list (2026-11-12) hides by its own « button or ⌘\ (the bar's button shows it again, and is there only
while it is hidden), and its right edge drags its width (160-520 px, double-click for the usual 236); both are kept in
the browser, per instance. Narrow (≤600 px) it opens over the page instead, as before.
The panel's code (2026-11-19) is ES modules, a part each -- the notebook, sending its ops, undo, others' changes, the
sidebar, the page, typing, the pop-ups, lines picked, tables, pictures, the actors and work items, the conversation,
the Work and Agents pages... -- loaded by one entry (`notes.js`, its page's one `<script type="module">`, after
DOMPurify, the kit and the SDK, read as globals), as app_kit.fileedit's are. What more than one module changes (the
SDK's `ag`, the notebook, the page open, the line whose conversation is open) is in `state.js`, each with its setter.
Nothing runs as they load: `start.js` connects the panel, then sets each module's listeners (its `wire...` function) in
the order they always were -- the document's key handlers rely on it -- and reads the notebook.
A panel closed mid-send (2026-11-20) loses nothing: before, the flush on `pagehide` / `visibilitychange` skipped the
queue while a batch was on its way, so a change queued behind it, and words still waiting for their pause, were never
sent. Now each batch a panel sends is named (`<panel>.<n>`) and the backend takes each name once (backend.py's module
doc), so as the page goes it sends, in one request kept alive past the page (`leaving`), the batch it was sending and
everything behind it, in order: whichever of that and the batch's own request comes first applies it, and the rest only
after it. A batch tried again after no answer keeps its name, so it is never applied twice either.
A page's lines (2026-11-21) are edited in one ProseMirror view, not a contenteditable each: one selection across
lines, no browser undo reaching from one line into another. The notebook and its ops are as they were: the doc is
drawn from the notebook, and each change made in it is the notebook's ops (`ag_apps/notes/DESIGN.md` says how, and why
undo stays the panel's own). ProseMirror is a committed ES module bundle the panel imports (`assets/src/notes`).

**Notes and the actors** (2026-11-08): the user works with the gatherer's actors from the notebook.
- **Sending a line:** `@` typed in a block (or its Assign / Ask button) picks an actor, the gatherer agent, or a new
  actor on a harness the dashboard runs; a box in the picker takes instructions to add to the line. The message is the
  user's own, as Chat sends one: a note first, "(From my Notes, page "…", block <id>. …)" -- first, so what the list
  keeps of a message (cut at 600 characters) still names the line -- then the line's words and what was added. The
  block keeps who it went to and with what: a call per agent (`calls`: `to`, `sent`, `extra`, `group`, `dropped`).
- **Each line's own status:** the line an actor is on now is the one its latest message names (`asked_of`); only it
  shows the actor working, or its question. A line the actor reported on since the user last wrote about it (or a
  ticked to-do) is Done, whatever the actor does next; another line sent to a busy actor waits ("After …"), else it
  shows Sent. Only the user ends a line's work (accepts or cancels it), and that changes no line: the page stays as
  written, the line's chip saying how its work ended. A to-do is ticked only by the user, which also ends its work as
  done, and then it is struck through and folded away (the user, 2026-11-11: "don't mark anything done at all
  automatically"). A message sent mid-turn becomes the
  latest one, so with two lines in one turn, the line it is on is the last one given it.
- **The block after:** one status line under it: how that actor stands now (working, needs you, done), its latest
  report (or what it asks), and a button that opens the conversation. The conversation is never on the page (the user,
  2026-11-08: "the notes itself should only have notes/status updates, not the conversation"). It is a panel beside
  the page, one line's at a time: the line as sent, the user's messages (each sent to the actor too) and the actor's
  reports as bubbles, its question answered there where the dashboard can (one question picked from options, or a
  permission), and a box to message it. Reports come from the new `notes_report` tool, one to three lines, which
  ticks a to-do the actor says is done. The block keeps them all as its `thread`.
- **The Agents page and the `/agents` block:** every actor with its state, what it was sent from the notes, and its
  last report.
- **Several lines at once** (2026-11-09): whole lines are picked, as Notion's block selection -- a drag from one line
  into others, a box dragged beside them, Shift+click, Esc then Shift+↑↓, ⌘A twice -- and are deleted (with an Undo),
  copied or cut (markdown, plus their own clipboard type so Notes pastes them back as they were), indented, moved,
  duplicated, ticked or turned into a type together. Sent to an agent, they go as ONE message: the note names every
  line, "blocks <id>, <id>, …", in the order the lines follow it as markdown, and asks for a report on each. `[asked]`'s
  third group is then those ids, ", " between, and every one of them is a line the actor is on. Each line keeps a call
  to it as one sent alone, with a `group` id their calls share. They show ONCE, at the last of them (the user:
  "the agent should only show once at the end of what was selected, not all the lines"): one status for them all
  (working or asking as the actor is, "1 of 2 done", Done once it reported on each) and one conversation -- the lines
  as sent, the user's replies (about them all, kept on the last), and a report on each, saying which line.
- **Several agents on a line, and one taken off** (2026-11-11, the user: "allow removing agent assignment to a note,
  and also adding another agent call for a line"): a line keeps a call per agent it went to, in the order sent
  (`calls`; a notebook from before, its one `to`, is read as its one call). Its "+" (on hover, at the end of the line;
  also the conversation's head and the line's menu) sends it to another agent, the picker leaving out those it is with;
  the note then says so ("I sent this line to actor <id> too; this message is for you"). Each agent shows its own chip,
  with how the line stands with it; the line as a whole (the Work page) stands as the most pressing of them -- asking,
  working, to review, queued -- and is accepted or canceled as one. The conversation beside the page is a tab per
  agent: the line as sent to it, the user's messages to it (each thread line names its `to`), its reports. "Remove
  from this line" (the conversation, or the line's menu) marks its call `dropped`: its chip goes, its tab and what was
  said stay, an agent still on the line or yet to take it up is told to leave it (a message, as Cancel's), and its
  `notes_report` on the line is refused since. Sent to it again, the call is its own again. Taken off every agent, the
  line is still a work item, sent to no one. The same words sent to two actors of one gatherer meet the context
  policy's requests made in parallel: the second gets the first's message, framed "not addressed to you", in the
  same user turn as its own. Haiku then took its own message for the other session's too and did nothing; the
  default model did its part.
- **What the contract gained, each general:**
  - capability `message_actors`: the SDK's `ag.actors.send` / `answer` / `start` / `show`, for any actor of the
    panel's gatherer ("gatherer": its gatherer agent, started if it has none), as Chat does them. `message_agents`
    stays limited to the agents attached to the instance; attaching an agent would have put it in the notebook's task.
  - `ag.actors` gives each actor's question (`asking`) and whether the page can answer it, whether it is saved, its
    role and recap, and the harnesses a new actor can start on.
  - `[asked]`'s pattern may have a second group, where in the app a message came from. Chat then shows "From
    <app> · <that>" above the user's words, and the list shows the words alone, for every actor, not only one the
    app started. A third group names the item the message is about; panels are told it as the actor's `asked_of`.
    The words may be read by a lookahead, so the note can come first (Python and JavaScript share no named groups).

**Pictures in Notes** (2026-11-11): a page can hold an image and a live Figma frame (the user: "design a diagram in
figma and put it in my notes").
- **Image blocks:** a picture pasted, dropped between lines, or picked from the `/` menu's Image is sent to the backend
  (`POST image`) and kept once in `apps/notes/data/files/`, named by its contents' hash, for every gatherer's notebook
  (a block copied to another notebook still finds it). The block keeps `file`, its size (`w`, `h`, read from the
  file's own header: no Pillow) and `width`, a percent of the page, dragged from its sides. Its words are its caption.
  Pictures are served under a `sandbox` Content-Security-Policy, so an SVG opened on its own runs nothing.
- **Figma blocks:** a Figma link pasted alone on a line asks "the frame, live" or "a link"; the `/` menu's Figma asks
  for one. The frame is Figma's own embed (Embed Kit 2.0: `embed.figma.com`, `embed-host=ag`) over a snapshot the
  backend keeps (`snap`). The snapshot comes from Figma's REST API with the user's personal access token (kept in
  `apps/notes/data/figma.json`, mode 600; the panel's "Add a Figma token"), fetched again only when Figma's
  `lastModified` changed. Without a token, Figma's oEmbed gives a public file's cover. The panel asks for it as the page
  shows the frame, at most every 10 minutes. It shows while the embed loads, offline, or when the reader picks it,
  and it is what agents see. Whether the reader is signed in to Figma can't be seen from outside its embed, so the
  embed says that itself. Figma's CDN refuses headless Chrome (403), so screenshots of the live frame need a normal
  user agent.
- **Agents:** `notes_read` returns the page's markdown, `![caption](image:<file>)` and `[Figma: name](url) -- caption`,
  then the pictures themselves: at most 6, each under 3.7 MB, never an SVG. Each is preceded by its block's id.
  `notes_add` / `notes_change` take `![caption](<a path>)`, read in from the agent's folder (not a URL), and a Figma
  link alone on a line; the snapshot of a new frame is fetched after the call answers. A picture is sent to no one
  (`UNSENT`): its caption is no line of work.

Steps 6–8 change what the user sees the most. Each gets its Playwright tests before it moves and keeps them after,
as the move to React did.

## Decisions

Settled on 2026-11-06:

1. **Every app's panel is an iframe**, ours and outside ones alike. One way for all apps; outside apps are isolated
   from the dashboard; our apps test the same contract an outside one uses. The cost: the SDK forwards keys, theme,
   focus and drag and drop across the frame, and each open panel costs about a page.
2. **Which tools an agent is given: every app installed, at launch** (an app installed is on in every group, since
   2026-11-17: no `apps = []` in a gatherer.toml any more; an app is removed by uninstalling it, ag's own too). Kept
   so once Preview, an app that comes with ag, put its tools in every session (2026-11-07). Works for Claude Code and Codex
   alike; costs context for each app's tools, so a gatherer's apps should be few. The others, kept for later:
   - only the apps it's attached to, with the list sent again when that changes. Claude Code refreshes on MCP's
     `tools/list_changed` (checked in its 2.1.319 binary); Codex knows the message, but whether it refreshes
     mid-thread is unconfirmed; and `mcp.py` would have to send notifications.
   - one tool, `app_call(app, tool, args)`, with each app's tools described in the instructions: cheapest in context,
     but the harness can't check arguments against a schema.
3. **Files and commands stay in Chat** (changed 2026-11-07, from "leave Chat for an Activity app"): they show the
   agent's own history, so they are part of its views.
4. **App backends run in the dashboard's process** for now. A separate `ag apps serve`, so apps work without the
   dashboard, can come later: nothing in `app_kit` assumes the dashboard.
5. **Names carry the app:** `<app>_<tool>` for tools and `<app>.<what>` for event types. One app's names can't collide
   with another's, and the host's checks are a prefix test.
