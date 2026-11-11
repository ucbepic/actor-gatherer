# Apps beside agents: plan

Status: being built, from 2026-11-06. Steps 1 (`app_kit/`), 2 (the host), 3 (the tool gateway), 4 (app panels), 5 (Preview), 8 (DocWriter, the Browser) and 7's first part (the Editor as an app, the Preview taken into it) are built. This file is the package's design, as
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
| Files and commands, file viewer | Inside Chat. `files.py`, `/api/files`, `legacy/16-files-view.js` | None | Reads `tool_call`, `tool_output`, `file_touched` (which ag's hook records, watching the disk as each call runs) and `actor_message` | None | Chat's left panel and file pane. The Editor's changes panel calls Chat's `fileBlock` |
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
  - the user, from a panel's agents menu, or by starting a new actor from a panel;
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
  | `selection` | the focused agent pane: its agent, and the turn, call or file selected in it (read-only) |
  | `theme` | light or dark, and the theme's colour tokens |
  | `native` | in the desktop app, a native web view at a rectangle of the panel (`native_view` capability) |

- **Intents separate agent views from apps.** A view raises an intent and the host sends it to the app that handles
  that kind, opening its panel in the row above the panes:
  - `open-file {path, line, row_id}`
  - `open-url {url}`
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
  ag_harness/home/        [apps] in config.toml (what is installed); apps = [...] in gatherer.toml (what is on)
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

- **Install:** `ag apps install <folder | git URL | pip package>` puts it in `<home>/apps/<name>/`. `ag apps list`
  shows what's installed; a gatherer turns apps on in its `gatherer.toml`, as it does pollers.
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
   - `ag_dashboard/tool_gateway.py`: the apps on for a gatherer (its `gatherer.toml`'s `apps`, else every app
     found), their tools as MCP lists them, their instructions, and each call resolved to an instance.
   - `POST /mcp/<actor>`, one MCP server per actor (the id it started under, so a codex session keeps it once its
     thread has its own), given to every session at launch whose harness takes one, when any app is on; a session's
     first message waits for it to have listed its tools, as for the app actors' servers now.
   - `ag apps [list]` and `ag apps call <app>_<tool> '<json>'`, through `/api/apps/agent` and `/agent/call`.
   - A tool its panel answers is sent to the instance's open panels as a message and waited for (30 s for a panel,
     120 s for its answer), as DocWriter's are now; the panel answers with `POST /api/apps/answer`.
   - An app's `[[pollers]]` are entries of ag's own catalog, `<app>.<name>` (`Home.pollers`, through app_kit's
     `finding`, so ag and the dashboard find the same apps). A gatherer runs one when its `gatherer.toml` names it
     in `pollers`, or names its app in `apps`; ag builds and checks it as any poller.
   - The Browser's and DocWriter's own endpoints stay until step 8; their actors are given those, not the gateway.
4. **App panels** (front end). Built, one change from the plan: app panes join the page's panes as they are (one
   more kind beside the actors', `07-panes.js`), and the layout tree waits; rebuilding the panes as a tree now would
   rewrite them under every other change to the page. Changed after step 5 (2026-11-07, its own PR): an app's panel
   is in the row above the panes (`#top-row`), beside the Editor, sharing its height; each panel's width its share
   (a bar before it); opening one shows the actor attached to it below, in the pane in focus (one open already: its
   pane focused); kept in this browser under `ag-dashboard-top-apps`.
   - The SDK, `app_kit/js/app.js`, served on every app's origin at `/_ag/app.js`: events (read, subscribe, insert),
     tools (answer, call), agents, intents, the selection, the theme (its colours set on the panel's `:root`), the
     backend's messages, its own `/api/`; Esc and ⌘/Ctrl keys it leaves unhandled go on to the page.
   - The page's side, `frontend/src/features/apps/host.ts`: an app's pane (its head: the app, its instance, the agents
     attached -- a menu attaches and detaches them -- and ×) and the bridge to its frame, which checks every message's
     source and origin. A panel has one stream for its backend's messages, a tool call among them, and one per
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
   (`offer = "attached"`); its panel in the top row under the head the dashboard draws over every app's. No button
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
     used (`/api/files/place`, `files.lately_changed`); `18-top.js` keeps what is the page's -- the top row's grip, the
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
   - **Writes around the tools** (a shell command, Codex's or Antigravity's own edits, an agent not attached): in Live
     merged as before; in Review and Hands off asked about (`Conflict.asked`), Reject putting the user's lines back on
     the file.
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
   - manifest: `offer = "attached"` (its tools and instructions only for an agent attached to one: its instructions
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
Agents get `notes_read`, `notes_add` and `notes_change` (offer `always`), and read and write pages as markdown with
each block's id. The test app it took the name of is now Notepad (`tests/apps/notepad/`). An app's mark now shows
on its "+ ⋯" menu entry too.

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

Steps 6–8 change what the user sees the most. Each gets its Playwright tests before it moves and keeps them after,
as the move to React did.

## Decisions

Settled on 2026-11-06:

1. **Every app's panel is an iframe**, ours and outside ones alike. One way for all apps; outside apps are isolated
   from the dashboard; our apps test the same contract an outside one uses. The cost: the SDK forwards keys, theme,
   focus and drag and drop across the frame, and each open panel costs about a page.
2. **Which tools an agent is given: every app turned on for the gatherer, at launch.** Kept so once Preview, an app
   that comes with ag, put its tools in every session (2026-11-07) -- the Editor's now (2026-11-08): a gatherer turns
   apps off with `apps = []`. Works for Claude Code and Codex
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
