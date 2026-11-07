# Apps beside agents: plan

Status: being built, from 2026-11-06. Steps 1 (`app_kit/`), 2 (the host) and 3 (the tool gateway) are built. This file is the package's design, as
`harness_kit/DESIGN.md` is that package's.

## Goal

A gatherer holds two kinds of things, and the code and the page should treat them as two kinds:

- **Agents.** The actors: harness sessions (Claude Code, Codex, ...) whose context the gatherer puts together. An
  agent's pane (Chat, Terminal, History, and the read-only Messages, Transcript and Details) shows that agent and
  nothing else.
- **Apps.** Everything an agent or the user works *with*: the Editor, the Browser, DocWriter, Preview, and the pieces
  now built into Chat and History (the files-and-commands panel, the file viewer, Summarize / Generate skill /
  memory / AGENTS.md). An app has a panel of its own beside or above the agent panes.

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

[capabilities]                        # shown to the user before they are granted
native_view = true                    # desktop: a native web view over its panel
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
    def call(self, instance, tool: str, args: dict, caller: Caller) -> ToolResult: ...
    def request(self, instance, method, path, query, body: bytes) -> Response: ...   # its panel's own routes
    def attached(self, instance, channel: str) -> None: ...     # an agent attached: tell it what it needs to know
    def detached(self, instance, channel: str) -> None: ...

class Host(ABC):                                                # what an app is given
    def insert(self, instance, events: List[dict], channel: Optional[str] = None) -> None: ...
    def read(self, instance, types, after=0, channel=None, limit=500) -> List[dict]: ...
    def attached(self, instance) -> List[str]: ...              # the channels of its agents
    def tell_panel(self, instance, message: dict) -> None: ...  # to its open panels
    def folder(self) -> str: ...                                # its own files: <home>/apps/<name>/data
    def instances(self) -> List[Instance]: ...
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
  that kind, opening its panel beside the pane:
  - `open-file {path, line, row_id}`
  - `open-url {url}`
  - `show-activity {channel, turn}`
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

### 6. What moves out of the agent views

| Piece | Becomes | How the agent view reaches it |
|---|---|---|
| Files-and-commands panel (Chat's left side) | **Activity** app: the agent's commands and files for the selected turn, from `tool_call`, `tool_output` and `file_touched` | A line per turn ("12 commands · 5 files") raises `show-activity`. The Activity panel follows the focused pane's selection |
| File viewer (Chat's file pane) | Activity for what a turn read or changed; the **Editor** for the file itself | `open-file` |
| Background tasks list | Stays in the agent view: the tasks are the agent's | — |
| Question and plan-approval card, errors | Stay: the harness asks, and the agent waits | — |
| `/context`, Details, Messages, Transcript | Stay: views of the agent | — |
| History's Summarize / Generate skill / memory / AGENTS.md, Save to..., Export | **Skills & memory** app; the skill watcher joins it later | History keeps its tree and selection. A selection raises `use-history` |
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
apps/                     our apps, each a package with an app.toml, built as an outside app would be
  preview/  activity/  editor/  browser/  docwriter/  skills/  sources/
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
   - `ag_dashboard/app_host.py` finds apps (the repo's `apps/`, `AG_APPS_PATH`, `<home>/apps/`), runs their
     backends (imported from their folder, or started as a process), and keeps instances and attachments as the
     host's records (`app_opened`, `app_closed`, `app_attached`, `app_detached`, `app_call`). A gatherer's are read
     once, the first time it is asked about.
   - `api/apps.py`: the page's routes (`/api/apps`, open, close, attach, detach, events, insert, call, a stream), an
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
4. **The layout and app panels** (front end).
   - The layout tree, with agent panes as its leaves.
   - `AppPanel` with the SDK's host side.
   - Intents and selection.
   - A test app in `tests/` that uses every part of the SDK.
5. **Preview, the first real app.** It is the smallest:
   - its CLI becomes tools;
   - its SQLite table becomes events (`preview.set`, `preview.ran`);
   - its panel is the Editor's preview side today.

   This proves the contract from start to end.
6. **Activity.** The files-and-commands panel and the file viewer leave Chat. Chat raises `show-activity` and
   `open-file` and publishes its selection. The Editor's changes panel stops calling Chat's code, and what both use
   goes to `core/ui`.
7. **The Editor.** Its tree, live editing, conflicts and viewers become the Editor app; it takes `open-file`. Its
   panel replaces the area above the panes.
8. **The Browser and DocWriter.**
   - Each becomes instances and attachments, with its tools through the gateway. A stored role
     (`{"browser": key}`) is copied to an `app_attached` once, here: until then they aren't apps the host knows.
   - `compose` and DocWriter's page-built prompt become `context_stream` events.
   - The desktop app's native view becomes the capability.
   - The `browser` and `docwriter` pane views go, and the per-app MCP endpoints with them.
9. **Skills & memory, and Sources.** History's actions move to Skills & memory. Sources becomes an app once it is
   merged.
10. **Apps from outside.** `ag apps install`, the permissions shown at install, and the store's manifest format.

Steps 6–8 change what the user sees the most. Each gets its Playwright tests before it moves and keeps them after,
as the move to React did.

## Decisions

Settled on 2026-11-06:

1. **Every app's panel is an iframe**, ours and outside ones alike. One way for all apps; outside apps are isolated
   from the dashboard; our apps test the same contract an outside one uses. The cost: the SDK forwards keys, theme,
   focus and drag and drop across the frame, and each open panel costs about a page.
2. **Which tools an agent is given: every app turned on for the gatherer, at launch.** Works for Claude Code and Codex
   alike; costs context for each app's tools, so a gatherer's apps should be few. The others, kept for later:
   - only the apps it's attached to, with the list sent again when that changes. Claude Code refreshes on MCP's
     `tools/list_changed` (checked in its 2.1.319 binary); Codex knows the message, but whether it refreshes
     mid-thread is unconfirmed; and `mcp.py` would have to send notifications.
   - one tool, `app_call(app, tool, args)`, with each app's tools described in the instructions: cheapest in context,
     but the harness can't check arguments against a schema.
3. **Files and commands leave Chat**, which keeps a one-line count per turn that opens Activity.
4. **App backends run in the dashboard's process** for now. A separate `ag apps serve`, so apps work without the
   dashboard, can come later: nothing in `app_kit` assumes the dashboard.
5. **Names carry the app:** `<app>_<tool>` for tools and `<app>.<what>` for event types. One app's names can't collide
   with another's, and the host's checks are a prefix test.
