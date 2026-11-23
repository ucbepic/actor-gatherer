"""What the routes the page reads return, as Pydantic models: the home (/api/home, and the stream's `home`), one actor
(/api/agent), its transcript, history, files and context, Chat's view of it (the stream's `chat`), the History view's
outline and records, the apps (/api/apps, the Apps page's catalog) and the settings. They describe the JSON for
FastAPI's schema (each route's `response_model`), which generates the page's types (frontend/src/core/api/types.gen.ts:
`pnpm gen:types`), and are checked against real answers in the tests (test_dashboard_app.py: each validates, and gives
back exactly what it was given); the routes do not serialize through them -- they send the JSON json.dumps writes, as
the page has always read it.

A field is written as what it always is: `x: str`, always there; `x: Optional[str]`, always there, perhaps null;
`x: Maybe[str]`, sometimes left out, never null; `x: Maybe[Optional[str]]`, sometimes left out, perhaps null. A route
that can answer {error} instead (its gatherer has no database yet, or nothing stored) says so: `Union[Agent, Failed]`.
A field not named here is kept (`extra="allow"`): the models say what the page reads, not all there is."""

from typing import Annotated, Any, Dict, List, Literal, Optional, Tuple, TypeVar, Union

from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema

T = TypeVar("T")

#: A field that may be left out: never null where it is there, unless its type says so (`Maybe[Optional[X]]`).
Maybe = Annotated[T, Field(default=None)]
#: A number, whole or not: seconds since the epoch, sizes summed from either (json.dumps writes each as it is).
Number = Annotated[Union[int, float], WithJsonSchema({"type": "number"})]
#: Lines added and removed: [added, removed].
Lines = Tuple[int, int]
#: A line of a file: [its number, its text].
NumberedLine = Tuple[int, str]


def _described(schema: Dict[str, Any], _model: Any) -> None:
    """The schema as the page's types are made from it: no `additionalProperties` (absent, JSON Schema's meaning is the
    same: a field not named may be there), no property's title (its name) nor its default (nothing is filled in)."""
    schema.pop("additionalProperties", None)
    for prop in schema.get("properties", {}).values():
        prop.pop("title", None)
        prop.pop("default", None)


class Model(BaseModel):
    """What every model here is: fields not named kept, and each field's docstring its description in the schema."""
    model_config = ConfigDict(extra="allow", json_schema_extra=_described, use_attribute_docstrings=True,
                              populate_by_name=True)


class Failed(Model):
    """A route's answer when it has none to give: its gatherer has no database yet, nothing is stored, or the read
    failed (the stream's `agent` and `chat`)."""

    error: str


# ---------------------------------------------------------------------------------------------------- the home

class Name(Model):
    """An actor's name (data.py's `_names`): the reader's (`by` "user"), else its harness's own, or the dashboard's."""

    text: str
    by: Optional[str]


class Recap(Model):
    """What its harness said it did while the user was away (its recap), cut to a line."""

    text: str
    at: Optional[Number]


class AskOption(Model):
    label: Optional[str]
    description: Optional[str]


class AskQuestion(Model):
    id: Any
    header: Optional[str]
    question: Optional[str]
    multiSelect: bool
    options: List[AskOption]


class Ask(Model):
    """What the agent waits on the user for (data.py's `ask_view`, `shown_ask`): questions, a plan to approve, a
    permission before a tool runs (the call as its harness shows it), or a dialog only its terminal's screen shows (a
    menu as it starts, or a permission no hook reported), with its options as the screen lists them."""

    id: Optional[str]
    """what an answer names it by: a permission's own key, else the call's"""
    kind: str
    harness: Optional[str]
    async_: bool = Field(alias="async")
    """asked as it goes on working: its turn does not wait on the answer"""
    at: Optional[Number]
    """when it asked"""
    call: Optional[str]
    questions: Maybe[List[AskQuestion]]
    plan: Maybe[Optional[str]]
    tool: Maybe[str]
    """a permission's call: its tool, what it is for, its input and view (the call's shape, as its harness reads it)"""
    said: Maybe[str]
    input: Maybe[Dict[str, Any]]
    view: Maybe[Dict[str, Any]]
    agent: Maybe[Any]
    """the subagent asking; None: the session"""
    title: Maybe[str]
    """a dialog's: its title, lines and options, the one its cursor is on; a menu shown as it starts; the options its
    harness ends after to update itself"""
    lines: Maybe[List[str]]
    options: Maybe[List[str]]
    cursor: Maybe[Optional[int]]
    menu: Maybe[bool]
    restarts: Maybe[List[int]]


class Answered(Model):
    """The last answer sent from the page to what it asked (data.py's `answer`): what it was, when, and -- once its
    harness recorded it -- what that made of it."""

    call: Optional[str]
    at: Number
    summary: str
    result: Optional[str]
    recorded: Optional[bool]


class Failing(Model):
    """Its model calls failing, retried (data.py's `failing`): since when, how often, the latest's error."""

    at: Number
    first: Number
    attempts: int
    status: Optional[int]
    error: Optional[str]
    retrying: bool


class Stopped(Model):
    """How a turn stopped short (data.py's `stopped`, files.py's): interrupted (Esc), on an error it gave up on, its
    process closed under it, or another reason its harness gives."""

    kind: str
    at: Maybe[Optional[Number]]
    text: Maybe[Optional[str]]
    status: Maybe[Optional[Union[int, str]]]
    reason: Maybe[Optional[str]]


class TakenBack(Model):
    """The message its harness put back in its box, stopped (Esc) before any of its answer came (data.py's
    `taken_back`): its words, when, and when ag read the call before."""

    text: str
    at: Number
    since: Optional[Number]
    cid: Maybe[Optional[str]]
    """the send it was, from Chat (Chat's view's)"""


class Holder(Model):
    """The process that has its session open (ag's launcher, its calls)."""

    pid: int
    by: Optional[str]
    dashboard: Maybe[bool]
    """the dashboard's own terminal, or a process under it"""


class Background(Model):
    """A task its harness runs in the background (data.py's `record_background`), with its last sign of life."""

    id: Maybe[Optional[str]]
    kind: Maybe[Optional[str]]
    label: Maybe[Optional[str]]
    started: Optional[Number]
    active: Optional[Number]


class Sent(Model):
    """A message sent from Chat (sessions.py's `send`): its id, words and time."""

    cid: Optional[str]
    text: str
    at: Number


class Session(Model):
    """A session the dashboard started or keeps (sessions.py's table, with `list`'s state of it now)."""

    session_id: str
    gatherer: str
    harness: str
    cwd: str
    permission_mode: str
    created_at: str
    turns: int
    status: str
    last_error: Optional[str]
    kept: Number
    model: Optional[str]
    started_as: Optional[str]
    ended: Number
    role: Optional[str]
    """a coordinator agent's role, or an app's actor's: its app and instance, as JSON (app_agents.py's `role_of`)"""
    over: Optional[str]
    harness_id: Optional[str]
    queued: List[str]
    """its messages waiting in the dashboard's queue"""
    terminal: bool
    """the dashboard runs it in a terminal"""
    answer: Optional[Dict[str, Any]]
    typed: Optional[Number]
    """when anything was last typed into its terminal"""
    stopped_at: Optional[Number]
    """when the key that stopped its turn was typed there"""
    shown: Optional[Dict[str, Any]]
    fullscreen: bool
    pid: Optional[int]
    since: Optional[Number]
    """when the dashboard's process of it started"""
    sent: List[Sent]


class Actor(Model):
    """An actor, as the list shows it (data.py's `_agents`; one started here with no message yet, `_with_started`'s),
    with its session, if the dashboard has one, and its avatar (avatars.py's `attach`)."""

    channel: str
    harness: Optional[str]
    name: Optional[Name]
    status: str
    """running, idle, closed, background, asking, error"""
    cwd: Optional[str]
    created: Optional[Number]
    last: Optional[Number]
    """its latest activity"""
    last_event: Optional[Number]
    last_read: Optional[Number]
    last_user_message: Optional[str]
    recap: Optional[Recap]
    events: int
    reads: int
    tasks: int
    est_tokens: Optional[int]
    real_tokens: Optional[int]
    limit_tokens: Optional[int]
    sent_tokens: Optional[int]
    running: bool
    building: bool
    turn_over: bool
    chattable: bool
    """the page may message it"""
    background: List[Background]
    avatar: Optional[str]
    avatar_hue: Optional[str]
    avatar_motion: Optional[str]
    """how its picture moves (its SVG's own word for it)"""
    avatar_hello: Optional[str]
    """what it says before its first message"""
    pid: Maybe[Optional[int]]
    alive: Maybe[Optional[bool]]
    since: Maybe[Optional[Number]]
    holder: Maybe[Holder]
    said_at: Maybe[Optional[Number]]
    stopped: Maybe[Optional[Stopped]]
    """how its last turn stopped: the model call it stopped on"""
    asking: Maybe[Optional[Ask]]
    failing: Maybe[Optional[Failing]]
    taken_back: Maybe[Optional[TakenBack]]
    session: Maybe[Session]
    role: Maybe[str]
    """its session's role: a coordinator agent's, or an app's actor's (its app and instance, as JSON)"""
    over: Maybe[str]
    """a coordinator agent's node (coordinators.py): "all", "groups:<id>", "folder:<id>"; none, its group's"""
    answer: Maybe[Answered]


class Notice(Model):
    """A notification an app sent, not settled since (app_kit's notices.py)."""

    id: str
    key: Optional[str]
    title: Optional[str]
    text: Optional[str]
    show: Optional[List[str]]
    """where it pops up: some of "ag", "system"; none, only listed"""
    where: Any
    """where in the app it is about, handed to its panel when opened"""
    at: Optional[Number]


class AppNotices(Model):
    """An app instance's open notifications (data.py's `app_notices`): `last`, when the newest came."""

    app: Optional[str]
    notices: List[Notice]
    last: Optional[Number]


class Gatherer(Model):
    """A gatherer, or group, and its actors, newest created first."""

    name: str
    policy: Optional[str]
    agents: List[Actor]
    last: Optional[Number]
    created: Optional[Number]
    """when it was made: its first event, else its config's time"""
    apps: Maybe[Dict[str, AppNotices]]
    """its apps' open notifications, by instance"""
    alone: Maybe[bool]
    """an actor on its own: a group of one (groups.py's `alone`)"""
    changed: Maybe[Number]
    """when what it holds last changed"""
    error: Maybe[str]
    """its database could not be read"""


class Folder(Model):
    """A folder of a gatherer's (folders.py), or of the gatherers' (gatherer_folders.py)."""

    id: int
    parent: Optional[int]
    name: str
    closed: Maybe[Optional[str]]
    """closed (folders.py's `close`): when, as an ISO time"""


class Folders(Model):
    """A tree of folders: the folders, and where each item is filed (an actor by its channel, an app by its item, a
    gatherer by its name)."""

    folders: List[Folder]
    filed: Dict[str, int]


class Place(Model):
    """Where a group is placed in another group (folders.py's `places`): that group, and its folder there (None: its
    top)."""

    in_: str = Field(alias="in")
    folder: Optional[int]


class Task(Model):
    id: int
    name: Optional[str]


class Tasks(Model):
    """A gatherer's tasks (tasks.py), oldest first, and the task each item is in."""

    tasks: List[Task]
    tasked: Dict[str, int]


class StoppedSays(Model):
    """A harness's words for a turn stopped short (harness_kit's `stopped_says`): the mark before them, an
    interruption, an error (with its HTTP status, `{status}`, when known), and other reasons, by their names."""

    lead: str
    interrupted: str
    error: str
    error_status: Maybe[str]
    reasons: Maybe[Dict[str, str]]


class PlanChoice(Model):
    id: str
    label: str
    title: Optional[str]
    primary: bool


class PlanChange(Model):
    label: str
    title: Optional[str]


class AskSays(Model):
    """How a reader answers what a harness asks (harness_kit's `ask_says`): its words, the ways to take a plan."""

    plan_verb: str
    plan_choices: List[PlanChoice]
    plan_change: PlanChange
    own_answer: str


class ReplyBlock(Model):
    """A block its model writes in a reply that its terminal draws apart (a proposed plan, say)."""

    open: str
    close: str
    title: str


class HarnessInfo(Model):
    """What the page shows of a harness (data.py's `harness_info`, from harness_kit)."""

    label: str
    mark: Optional[str]
    """its mark, an SVG"""
    runs: bool
    """the dashboard runs it: it can start and resume its sessions"""
    fullscreen: bool
    stopped: StoppedSays
    ask_says: AskSays
    asks_shown_again: bool
    """whether its terminal, opened again, asks again what it asked before"""
    reply_block: Optional[ReplyBlock]
    mcp: bool
    memory_folder: Optional[str]
    """where it keeps its memory of a directory (a pattern its folders end with)"""
    saves: Dict[str, Dict[str, Any]]


class Shell(Model):
    """A shell open (sessions.py's `shell`), listed under its gatherer."""

    id: str
    gatherer: str
    cwd: str
    since: Number
    folder: Optional[int]


class Branch(Model):
    """An actor's branch of a project, in a worktree of its own (branches.py's `listed`)."""

    session_id: str
    channel: Optional[str]
    gatherer: str
    project: str
    worktree: str
    branch: str
    start: Optional[str]
    started_on: Optional[str]
    onto: Optional[Dict[str, Any]]
    approve: bool
    held: Dict[str, Any]


# ----------------------------------------------------------------------------------- the apps (and the Apps page)

OnTask = Literal["join", "folder", "no"]
"""What "+" on an actor or a task does with an app (app_policy.py)."""


class AppData(Model):
    """Where an app keeps its data, how much, and whether it is there."""

    path: str
    bytes: int
    there: bool


class CatalogApp(Model):
    """An app as the Apps page lists it, or as an agent's request names it: installed (`InstalledApp`), one that comes
    with ag, uninstalled (`UninstalledApp`), one of the index's (`IndexApp`), staged (`Staged`) -- or, an app that comes
    with ag no longer found, its name alone."""

    name: str
    label: str
    description: Maybe[str]
    origin: Maybe[str]
    """where it is: "builtin" (comes with ag), "home" (installed), "path" (AG_APPS_PATH), "index", "staged\""""
    kind: Maybe[str]
    source: Maybe[str]
    version: Maybe[str]
    mark: Maybe[bool]
    commit: Maybe[str]
    installed_at: Maybe[Any]
    access: Maybe[str]
    """who may use its instances: "task" (the agents in its task) or "group" (every agent of the group)"""
    with_agent: Maybe[bool]
    """it can be opened with an agent of its own (its manifest's [agent] offered)"""
    opens_with_agent: Maybe[bool]
    """opened, it starts with an agent of its own: the reader's choice (app_settings.py)"""
    instances: Maybe[str]
    on_task: Maybe[OnTask]
    """what "+" on an actor or a task does with it, as chosen; its manifest's own; and those it can take"""
    on_task_own: Maybe[OnTask]
    on_task_can: Maybe[List[OnTask]]
    tools: Maybe[List[str]]
    tokens: Maybe[int]
    """what its tools' descriptions cost an agent"""
    can: Maybe[List[str]]
    own_process: Maybe[bool]
    panel: Maybe[bool]
    schedules: Maybe[List[str]]
    open: Maybe[Dict[str, int]]
    """its windows open: {gatherer: how many}"""
    data: Maybe[AppData]
    failed: Maybe[Optional[str]]
    needs: Maybe[str]


class DescribedApp(CatalogApp):
    """An app as its manifest describes it (app_catalog.py's `described`): its words, what agents get of it, what it may
    do, where it came from."""

    description: str
    origin: str
    kind: str
    source: str
    version: str
    mark: bool
    commit: str
    installed_at: Any
    access: str
    with_agent: bool
    opens_with_agent: bool
    instances: str
    on_task: OnTask
    on_task_own: OnTask
    on_task_can: List[OnTask]
    tools: List[str]
    tokens: int
    can: List[str]
    own_process: bool
    panel: bool
    schedules: List[str]


class InstalledApp(DescribedApp):
    """An app installed: with its windows open, its data, and why its backend failed (None: it didn't)."""

    open: Dict[str, int]
    data: AppData
    failed: Optional[str]


class UninstalledApp(DescribedApp):
    """An app that comes with ag, uninstalled: its data, kept or not."""

    data: AppData
    needs: str


class IndexApp(CatalogApp):
    """An app of the index, to install from git."""

    description: str
    origin: str
    kind: str
    source: str
    needs: str


class Broken(Model):
    """An app whose manifest can't be read."""

    folder: str
    name: str
    error: str
    origin: str


class Found(Model):
    """The apps the server found added, gone or changed as it read their folders again."""

    added: List[str]
    gone: List[str]
    changed: List[str]


class Catalog(Model):
    """The Apps page (/api/apps/catalog): every app installed, those it can install, and those it can't read."""

    installed: List[InstalledApp]
    available: List[Union[UninstalledApp, IndexApp]]
    found: Found
    broken: List[Broken]


class Changes(Model):
    """What an update changes that the user should see."""

    version: List[str]
    tools_added: List[str]
    tools_gone: List[str]
    can_added: List[str]
    own_process: bool


class Staged(DescribedApp):
    """An app copied aside and checked (/api/apps/stage), to be installed or discarded: and the one installed of its
    name, with what installing it would change."""

    id: str
    installed: Maybe[DescribedApp]
    changes: Maybe[Changes]


class Updates(Model):
    """The apps installed from git that have a newer commit (/api/apps/updates): {name: commit}."""

    updates: Dict[str, str]


class AppRequest(Model):
    """An agent's asking to install, update or uninstall an app (app_requests.py), waiting for the user."""

    id: str
    actor: str
    gatherer: Optional[str]
    op: Literal["install", "update", "uninstall"]
    args: Dict[str, Any]
    about: CatalogApp
    state: str
    said: str
    at: Number


class AgentOffer(Model):
    """An app's `[agent]`: whether it can be opened with an agent of its own, and the name that agent is given."""

    offered: bool
    name: str


class ToolListed(Model):
    """A tool an app gives agents, and what handles its calls (its backend, or its panel)."""

    name: str
    description: str
    input_schema: Dict[str, Any]
    handled_by: str


class Handles(Model):
    """An intent an app handles, for these types."""

    intent: str
    types: List[str]


class LinkForm(Model):
    """The paths of `ag://<app>/...` links an app's panel opens (app_kit/links.py); `paths`, a file's path an agent
    writes with no app named opens in it."""

    form: str
    about: str
    paths: Maybe[bool]


class Capabilities(Model):
    """What an app may do beyond its own panel and tools (its manifest's `[capabilities]`)."""

    native_view: bool
    reads: List[str]
    files: bool
    commands: bool
    message_agents: bool
    transcript: bool
    edit_guard: bool
    docs: bool
    actors: bool
    notify: bool
    message_actors: bool


class AppListed(Model):
    """An app found, as the host lists it (/api/apps): its manifest (app_kit's `to_dict`), its panel's origin and
    folder, whether the reader opens it with an agent of its own, why its backend failed (None: it didn't), and what
    "+" on an actor or a task does with it as chosen."""

    name: str
    label: str
    version: str
    description: str
    instances: str
    access: str
    on_task: OnTask
    instructions: str
    agent: AgentOffer
    mark: bool
    panel: Optional[str]
    tools: List[ToolListed]
    handles: List[Handles]
    links: List[LinkForm]
    capabilities: Capabilities
    origin: str
    folder: Optional[str]
    opens_with_agent: bool
    failed: Optional[str]


class Instance(Model):
    """An app's open instance (app_kit's `Instance`): `name`, the user's ("": not named), shown over its `title`."""

    id: str
    app: str
    gatherer: str
    folder: Optional[str]
    title: str
    data: Dict[str, Any]
    name: str


class BrokenFolder(Model):
    folder: str
    error: str


class Apps(Model):
    """The apps found, those whose manifest can't be read, and -- for a gatherer -- its open instances, the agents
    attached to each, and its tasks, with when they were read (`now`)."""

    apps: List[AppListed]
    broken: List[BrokenFolder]
    instances: List[Instance]
    attached: Dict[str, List[str]]
    tasks: Maybe[Tasks]
    now: Maybe[Number]


class HookServer(Model):
    """A hook server ag started that still runs (home.py's `hook_servers`)."""

    port: Optional[int]
    pid: Optional[int]
    upstream: Optional[str]


class Home(Model):
    """The home (/api/home, and the stream's `home`): every gatherer and its actors, what the reader keeps of them, what
    each harness is; and what a new session starts from here (`Server.read_home`). A snapshot's home (`ag dashboard
    --out`: data.snapshot) is data.home()'s alone: none of read_home's fields (`app_groups` on)."""

    home: str
    merged: bool
    """the home's one database (ag home merge)"""
    now: Number
    running_seconds: Number
    gatherers: List[Gatherer]
    hook_servers: List[HookServer]
    hiding: Dict[str, str]
    """{gatherer: "hidden" | "shown"}"""
    titles: Dict[str, str]
    """the reader's names for gatherers"""
    saved: Dict[str, Dict[str, str]]
    """{gatherer: {channel: when saved}}"""
    folders: Dict[str, Folders]
    gatherer_folders: Folders
    places: Dict[str, Place]
    tasks: Dict[str, Tasks]
    seen: Optional[Dict[str, Dict[str, Number]]]
    """{gatherer: {channel: last}}; None, never kept"""
    harness_info: Dict[str, HarnessInfo]
    harness_default: str
    """the harness taken for an actor recorded before ag recorded its harness"""
    app_groups: Dict[str, str]
    """the group each open app is in, by its instance's id"""
    cwd: str
    permission_modes: List[str]
    terminals: bool
    harnesses: List[str]
    """the harnesses a new session can run on here"""
    shells: List[Shell]
    home_dir: str
    branches: List[Branch]
    app_requests: List[AppRequest]


# ---------------------------------------------------------------------------------------------- one actor over time

class Item(Model):
    """An item of a context (data.py's `context` items), or one the next call will carry (`_pending`, `_after_read`):
    an event, ag's made item, a preamble's part -- its group, its size and text (`clipped`: how much more there is)."""

    position: Optional[int]
    group: str
    name: str
    tokens: int
    row_id: Optional[int]
    made_id: Optional[int]
    at: Optional[Number]
    clipped: int
    text: str


class HistoryItem(Model):
    """An event of an actor's history (data.py's `history`): its type (`name`), size, time and text (`clipped`: how
    much more there is); to its newest, its pending events after them, as a context lists them (`Item`)."""

    row_id: Optional[int]
    name: str
    tokens: int
    at: Optional[Number]
    clipped: int
    text: str
    position: Maybe[Optional[int]]
    group: Maybe[str]
    made_id: Maybe[Optional[int]]


class Read(Model):
    """A model call ag answered (a read) and its sizes."""

    read_id: int
    at: Optional[Number]
    row_id: Optional[int]
    basis: Optional[Union[int, str]]
    recorded_tokens: Optional[int]
    est_tokens: Optional[int]
    real_tokens: Optional[int]
    limit_tokens: Optional[int]
    sent_tokens: Optional[int]
    preamble_tokens: Optional[int]
    tasks: int
    """the tasks begun by then"""
    rebuild: bool


class Typed(Model):
    """What the user wrote to the session as it worked, or sent between turns (data.py's `typed`)."""

    text: str
    at: Optional[Number]
    sent: Optional[Number]
    joins: bool
    chat: Maybe[bool]


class AgentTask(Model):
    """A task ag made of the actor's history."""

    index: int
    name: str
    description: Optional[str]
    first_row: int
    last_row: int
    tokens: Optional[int]
    started: Optional[Number]
    ended: Optional[Number]


class Build(Model):
    """A build of the actor's history (an analysis): why it started, how long it took, how it ended."""

    build_id: int
    status: str
    started: Optional[Number]
    finished: Optional[Number]
    through_row: Optional[int]
    error: Optional[str]
    reason: Optional[str]


class Check(Model):
    """A check of whether a message began a new task."""

    row_id: Optional[int]
    asked: Optional[Number]
    decided: Optional[Number]
    new_task: Optional[bool]
    why: Optional[str]


class LlmRow(Model):
    """ag's own model calls for the actor, for one purpose."""

    purpose: str
    calls: int
    tokens_in: int
    tokens_out: int
    seconds: Number
    errors: int
    cost: Number
    unpriced: int
    models: List[str]


class LlmTotal(Model):
    calls: int
    tokens_in: int
    tokens_out: int
    errors: int
    cost: Number
    unpriced: int


class LlmCall(Model):
    purpose: Optional[str]
    started: Optional[Number]
    seconds: Optional[Number]
    tokens_in: int
    tokens_out: int


class Llm(Model):
    """ag's own model calls for the actor, by what they were for."""

    by_purpose: List[LlmRow]
    total: LlmTotal
    calls: List[LlmCall]


class UsageEntry(Model):
    """One kind of what all calls sent, added up."""

    group: str
    name: str
    items: int
    tokens: int


class Usage(Model):
    """Every item every call of the actor sent, added up by kind (data.py's `_usage`)."""

    tokens: int
    entries: List[UsageEntry]
    not_counted: int
    calls: int
    real_tokens: int
    real_calls: int


class Agent(Model):
    """One actor over time (/api/agent, and the stream's `agent`): its calls and reads, what is pending, its tasks,
    builds and checks, the Gatherer's model calls for it."""

    gatherer: str
    channel: str
    harness: Optional[str]
    reads: List[Read]
    pending: List[Item]
    typed: List[Typed]
    after_read: List[Item]
    """what the channel has since the latest call: the next call will carry it"""
    tasks: List[AgentTask]
    builds: List[Build]
    checks: List[Check]
    rebuilds: int
    llm: Llm
    usage: Usage
    llm_attributed_by_time: int


class Context(Model):
    """The context a call sent (/api/context), in order; what the harness sent besides its messages (`preamble`)."""

    read_id: int
    cut: Any
    at: Optional[Number]
    basis: Optional[Union[int, str]]
    real_tokens: Optional[int]
    tokens: int
    preamble: List[Item]
    not_counted: Optional[int]
    items: List[Item]


class ToolCall(Model):
    """A call a script makes (codex's code mode), as its harness's rules read it."""

    name: Optional[str]
    input: Any
    action: Any
    view: Dict[str, Any]


class Part(Model):
    """A part of an event, as the transcript shows it, whatever harness wrote it (data.py's `parts`), by `kind`: "text"
    (`role`: user, assistant, system), "thinking" ("" when encrypted), "call" (`id`, `name`, `input`; what it does and
    how it is shown, as its harness's rules read it: `action`, `view`; a script's `calls`), "result" (its call's `id`,
    `error`, `text`; its harness's lines about the run taken off, `shown`, and what they said: `exit`, `took`), "note"
    (`name`, `text`; what its harness's rules read of it: `said`)."""

    kind: str
    role: Maybe[str]
    text: Maybe[str]
    id: Maybe[Optional[str]]
    name: Maybe[Optional[str]]
    input: Maybe[Any]
    action: Maybe[Any]
    view: Maybe[Dict[str, Any]]
    calls: Maybe[List[ToolCall]]
    error: Maybe[bool]
    shown: Maybe[Any]
    exit: Maybe[Any]
    took: Maybe[Any]
    said: Maybe[Any]


class TranscriptItem(Model):
    """An event of the transcript: stored (its row), or pending (none)."""

    row_id: Optional[int]
    type: str
    at: Optional[Number]
    parts: List[Part]


class Transcript(Model):
    """An actor's transcript (/api/transcript): its events, oldest first; whether it has earlier ones, and whether these
    reach its newest."""

    items: List[TranscriptItem]
    earlier: bool
    newest: bool


class History(Model):
    """An actor's own events from a row (/api/history); `more` counts the rest."""

    first_row: int
    last_row: Optional[int]
    items: List[HistoryItem]
    more: int


# ------------------------------------------------------------------------------------------------ files and Chat

class Reply(Model):
    """A message of the agent's in a turn (files.py's `replies`): what it said, a run of its thinking, or a note of its
    harness's (a subagent's report handed back, another session's message)."""

    kind: str
    text: Maybe[str]
    texts: Maybe[List[str]]
    """thinking's runs; none readable when encrypted"""
    name: Maybe[Optional[str]]
    """a report's task, or the session a message came from"""
    after: int
    """how many of the turn's calls came before it"""


class Doing(Model):
    """What the agent does now: a call, or thinking."""

    kind: str
    id: Maybe[Optional[str]]
    text: Maybe[str]


class Call(Model):
    """A call of a turn (files.py's): its line, the call as its harness's view reads it, and how it went."""

    text: str
    call: Any
    running: bool
    error: bool
    output: str
    exit: Maybe[Optional[Union[int, str]]]
    took: Maybe[Optional[str]]


class CallRun(Call):
    """A turn's latest call, while nothing readable followed it (files.py's `last`)."""

    id: Optional[str]


class UserMessage(Model):
    """A message of the user's written while a turn ran (`more`), with its send's id, sent from Chat (Chat's view's)."""

    text: str
    row_id: Optional[int]
    at: Optional[Number]
    kind: str
    cid: Maybe[Optional[str]]


class SentMessage(Model):
    """A message the actor sent another (files.py's `sent`: `ag actors send`, or a new actor started with it)."""

    text: str
    kind: Optional[str]
    to: Optional[str]
    to_name: Optional[str]
    at: Optional[Number]


class WorkEnded(Model):
    id: Any
    kind: str
    ok: bool
    at: Number


class Work(Model):
    """What an actor's turn is doing, from its calls (work.py's `summary`): the kind of its newest call running, of its
    newest call, its subagents running, its newest call ended, the calls that failed in a row."""

    doing: Optional[str]
    last: Optional[str]
    helpers: int
    ended: Optional[WorkEnded]
    failed: int


class Turn(Model):
    """A turn (files.py's): the user's message, what the agent said and did, how it ended."""

    n: int
    row_id: Optional[int]
    at: Optional[Number]
    end: Optional[Number]
    """its last event's time"""
    text: str
    replies: List[Reply]
    now: Optional[Doing]
    more: List[UserMessage]
    last: Optional[CallRun]
    """its latest call, while nothing readable followed it"""
    stopped: Optional[Stopped]
    calls: int
    """its calls, as many as its commands list"""
    kind: str
    """what the user's message is, as its harness's wrapper says (harness_kit's `words`)"""
    work: Work
    """what the avatar acts out"""
    sent: Maybe[List[SentMessage]]
    output: Maybe[Optional[str]]
    """a `!` command's output"""
    cid: Maybe[Optional[str]]
    """Chat's view's: the send it is (sent from Chat), and when its message was sent"""
    began: Maybe[Optional[Number]]


class Block(Model):
    """What a call did to a file (files.py's blocks), by `t`: the lines it read (`lines`, from `start`: None, not
    known), matches it found (`hits`: `rows`), a change (`diff`: `old` replaced by `new` at `at` -- None, not found --
    with the known lines `above` and `below`; `write`, `append`: its `lines`), what a command printed (`output`), an
    image its result holds (`image`: `row_id`, `id`), a note (`text`); `cut`, how many more lines there were."""

    t: str
    lines: Maybe[List[str]]
    start: Maybe[Optional[int]]
    cut: Maybe[int]
    rows: Maybe[List[NumberedLine]]
    at: Maybe[Optional[int]]
    old: Maybe[List[str]]
    new: Maybe[List[str]]
    above: Maybe[List[NumberedLine]]
    below: Maybe[List[NumberedLine]]
    created: Maybe[bool]
    row_id: Maybe[int]
    id: Maybe[str]
    text: Maybe[str]


class Source(Model):
    """A call that touched a file (files.py's sources): what it did to it, by kind; how (`via`); the lines its changes
    added and removed. What git did as it ran is one apart (`git`). Where ag's hook server checked it on disk,
    `checked` (None: nothing to match), and `unnamed`, the file changed as it ran but the call doesn't name it."""

    via: str
    kind: str
    kinds: List[str]
    error: bool
    call: Any
    blocks: List[Block]
    at: Optional[Number]
    changed: Optional[Lines]
    git: Maybe[bool]
    checked: Maybe[Optional[bool]]
    unnamed: Maybe[bool]


class TurnFile(Model):
    """A file a turn touched (files.py's `files`): what each call did to it, by kind; the lines added and removed."""

    path: str
    kinds: List[str]
    created: bool
    changed: Optional[Lines]
    git: List[str]
    """what git changed of it as the turn's commands ran: its kinds"""
    sources: List[Source]
    temporary: bool


class Command(Call):
    """A call of a turn, as its commands list it (files.py's `commands`): with the files it touched, and what it did to
    each (git's, as it ran, apart); a skill the user loaded with its /name, a call of its own (`loaded`)."""

    files: List[str]
    loaded: Maybe[bool]
    did: Maybe[Dict[str, List[str]]]
    git: Maybe[Dict[str, List[str]]]
    changed: Maybe[Optional[Lines]]


class Files(Model):
    """An actor's turns, and the one shown (`turn`, its index; the latest, unless one is picked) with its files and
    commands (/api/files)."""

    turns: List[Turn]
    turn: Optional[int]
    files: List[TurnFile]
    commands: List[Command]
    home: str


class Opening(Model):
    """A turn sent and not stored yet (chat_view.py's `opening`): its message, the send it is, when it was sent, whether
    the session has it (`seen`), not had for long (`unseen`), and stopped before its harness recorded anything."""

    text: str
    cid: Optional[str]
    began: Number
    seen: bool
    unseen: bool
    stopped: Maybe[Optional[Stopped]]


class Current(Model):
    """The latest turn's state (chat_view.py's `_state`): a turn opening, at work, asking the user, done, stopped short
    (`stopped`: how), or no turn yet; the turn it is ("opening": the opening); what it does, and its calls failing."""

    state: Literal["opening", "working", "asking", "done", "stopped", "idle"]
    turn: Optional[Union[int, Literal["opening"]]]
    doing: Optional[Doing]
    failing: Optional[Failing]
    asking: Optional[Ask]
    stopped: Optional[Stopped]


class Waits(Model):
    """What waits for the agent's next step (chat_view.py's `waiting`): held by its harness for its turn's end
    ("queued"), sent from Chat while it worked ("chat"), or in the dashboard's own queue for it ("dashboard")."""

    text: str
    cid: Optional[str]
    how: Literal["queued", "chat", "dashboard"]


class ChatView(Model):
    """What Chat shows of an actor's conversation, as the server made it from one read (the stream's `chat`:
    chat_view.py's `view`)."""

    turns: List[Turn]
    opening: Optional[Opening]
    current: Current
    waiting: List[Waits]
    taken_back: Optional[TakenBack]
    """the message Esc took back, before any of its answer came"""
    version: List[Any]


class StreamActor(Model):
    """Another actor the page shows (the stream's `actor`): its agent and Chat's view of it."""

    gatherer: str
    channel: str
    agent: Union[Agent, Failed]
    chat: Union[ChatView, Failed]


class Stream(Model):
    """The page's stream (/api/stream: server-sent events), each event's data by its name: `home`; with an actor, its
    `chat` and `agent`; the page's other actors, each an `actor`."""

    home: Maybe[Home]
    chat: Maybe[Union[ChatView, Failed]]
    agent: Maybe[Union[Agent, Failed]]
    actor: Maybe[StreamActor]


class MonitorStep(Model):
    text: str
    running: bool
    error: bool


class MonitorActor(Model):
    """An actor's latest turn, as the monitor shows it (monitor.py's `actor`): {turns: 0} before its first message;
    {error} where it could not be read."""

    gatherer: str
    channel: str
    turns: Maybe[int]
    at: Maybe[Optional[Number]]
    asked: Maybe[Optional[str]]
    more: Maybe[int]
    said: Maybe[Optional[str]]
    now: Maybe[Optional[Doing]]
    work: Maybe[Work]
    steps: Maybe[List[MonitorStep]]
    calls: Maybe[int]
    files: Maybe[Dict[str, int]]
    error: Maybe[str]


class Monitor(Model):
    """The monitor's actors (/api/monitor)."""

    actors: List[MonitorActor]


# --------------------------------------------------------------------------------------------- the History view

class OutlineEvent(Model):
    """An event of the outline (history.py's `outline`): light, its text cut short."""

    row_id: int
    channel: str
    type: str
    tokens: int
    at: Optional[Number]
    text: str


class OutlineTask(Model):
    """A task ag found (its build's), from its first row."""

    channel: str
    index: int
    name: str
    description: Optional[str]
    first_row: int
    last_row: int
    tokens: Optional[int]


class BuildState(Model):
    """How a channel's latest build of its own history stands, and the user messages since."""

    since: int
    build_id: Maybe[int]
    status: Maybe[str]
    started: Maybe[Optional[Number]]
    finished: Maybe[Optional[Number]]
    error: Maybe[Optional[str]]
    reason: Maybe[Optional[str]]


class Outline(Model):
    """A gatherer's events after a row (/api/outline), the tasks ag made of them, each channel's latest build."""

    events: List[OutlineEvent]
    tasks: List[OutlineTask]
    builds: Dict[str, BuildState]
    more: bool


class Memory(Model):
    name: str
    title: str
    type: str
    description: str
    body: str


class Saving(Model):
    at: Number
    where: Any
    paths: List[str]


class Extract(Model):
    """What the Gatherer's model made of a gatherer's history (history.py's records): a summary, memories, a skill."""

    id: str
    gatherer: str
    kind: str
    status: str
    output: str
    error: Optional[str]
    model: Optional[str]
    created: Number
    finished: Optional[Number]
    rows: List[Tuple[int, int]]
    """the rows it was made of, as runs: [first, last]"""
    channels: List[str]
    ask: Optional[str]
    messages: int
    turns: int
    dirs: List[str]
    memories: Maybe[List[Memory]]
    saved: Maybe[List[Saving]]


class Hit(Model):
    row_id: int
    snippet: str


class Search(Model):
    """What a search of a history found (/api/search): each matching row's snippet, and whether there were more."""

    hits: List[Hit]
    more: bool


class Event(Model):
    """One event as the transcript shows it (/api/event)."""

    row_id: int
    type: Optional[str]
    parts: List[Part]


# -------------------------------------------------------------------------------------------------- the settings

class LlmSetting(Model):
    model: str
    api_base: str
    key_env: str


class Choices(Model):
    default: str
    available: List[str]


class PollerChoices(Model):
    default: List[str]
    available: List[str]


class Cli(Model):
    gatherer: str
    harnesses: Dict[str, Dict[str, Any]]


class Settings(Model):
    """ag's settings (/api/settings: settings.py's `read`), its config.toml as the panel shows it; `error`, why it
    doesn't parse ("": it does). After setting the model, what it runs on, in words (`said`)."""

    path: str
    exists: bool
    text: str
    version: str
    error: str
    env: Dict[str, str]
    llm: LlmSetting
    policies: Choices
    pollers: PollerChoices
    cli: Cli
    said: Maybe[str]
