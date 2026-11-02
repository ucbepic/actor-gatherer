# Harnesses as events: design

The design behind `harness_kit/` and the events ag's hooks record, as built so far. It follows the design doc
"Harnesses as events: design" (a Claude Doc), and says where the build went another way and why. Steps 1–4 of
its order of work are built (#138, #144), step 5 (#149), and steps 6–7 (one PR).

## Goal

Every fact ag learns about a harness session becomes an event in the gatherer, inserted by ag's integration for
that harness, and the dashboard reads only events. Before this work the rules that recognise each kind of message
sat in about 15 files across the hooks, the adaptors, the dashboard and the page, and the dashboard read Claude
Code's and Codex's session files itself (`queued.py`, `rollout.py`).

- **One store.** What the model was sent, its replies, side calls, the harness's own session file and files changed
  on disk all become events. ag's tables for its own work stay: reads, made items, preambles, polls, claims, and
  `_withdrawn` (#133), which changes what a read sees and so is ag's own work, not a record of the harness's.
- **Two families of events.** Conversation events are what the model is sent: the six types the policy reads.
  Harness events (records) are everything else, types the policy groups none of, so they never reach a context.
- **Harness facts live outside ag**, one module per harness, standard library only.
- **The integration inserts, the dashboard reads.** The dashboard never reads a harness's files or parses its text.
- **Rules carry their version**: each harness names the version its rules were read from (`checked_with`), and each
  call records the version that made it (`model_call.version`).

## Three layers

| Layer | Where | Holds | Imports |
|---|---|---|---|
| Harness module | `harness_kit/` (top level, beside `ag/` and `ag_dashboard/`) | facts true without ag: what each call is, which text is the harness's own, what each tool does, the shell parser | the standard library only (`tests/test_harness_kit.py`) |
| ag integration | `ag/integrations/harnesses/<name>/`, `ag/integrations/tools/ag_orchestrator/` | event ids, `to_messages`, the hook flow (`ProxyHook`), the records it inserts | `harness_kit`, ag |
| Policy binding | attributes of the harness's adaptor | which event type each `Kind` becomes (`event_types`, `other`), `outputs`, `accepts`, `properties`, `event_properties` | ag |
| Dashboard | `ag_dashboard/` | reads events, draws them, sends actions | `harness_kit`; nothing of ag (`test_dashboard.SeparateTest`) |

`harness_kit` is the package's name: `harnesses`, the name the doc proposed, is taken on PyPI (so are
`agent_harnesses` and `agent-harnesses`). `pyproject.toml` finds it beside `ag*`.

## The Harness class (`harness_kit/base.py`)

```python
class Harness(ABC):
    name = "claude"; label = "Claude Code"; checked_with = "2.1.310"

    # Level 1: one model call
    def call(self, method, path, headers, body) -> Optional[Call]: ...   # None: no model call
    def title(self, reply: List[Part]) -> Optional[str]: ...             # default: the reply's words
    def recap(self, reply: List[Part]) -> Optional[str]: ...             # default: the reply's words

    # Levels 2 and 3: its pieces, and the tool calls among them
    @abstractmethod
    def items(self, history: list) -> list: ...
    @abstractmethod
    def read(self, items: list) -> List[Part]: ...
    def read_one(self, payload) -> List[Part]: ...                       # a stored piece, its neighbours unknown
    def words(self, text: str) -> tuple: ...                             # (Kind, the user's words as typed)

    # Its own record of a session (step 4)
    def record_path(self, session, cwd=None, config=None) -> Optional[str]: ...
    def follower(self, path) -> Optional[Follower]: ...

    # What its calls and answers say besides the conversation (step 5)
    asks_recorded = False                                                 # Codex: True, its record has them
    def derived(self, parts, at, history=None) -> List[Fact]: ...

    # Run in a terminal, and answered there (step 5)
    def command(self, session, resume=False, model=None, permission_mode=None, fullscreen=True) -> List[str]: ...
    def models(self, env=None) -> dict: ...
    def answer_keys(self, ask, choice) -> List[str]: ...
    def answer_expected(self, ask, choice) -> List[str]: ...
    def answer_summary(self, ask, choice) -> str: ...
```

- `Call(kind, session, cwd, version, history, own, detail)`: `kind` one of TURN, SUBAGENT, SUGGESTION, RECAP,
  TITLE, COMPACTION, OTHER; `own` the call's own messages after the conversation (a suggestion's prompt, a
  compaction's instruction). Claude Code's version comes from its User-Agent (`claude-cli/<v>`), Codex's from
  its (`codex-tui/<v>` from its terminal, `codex_exec/<v>` from `codex exec`).
- `Part(kind, role, text, words, tool, result, cwd, opaque, detail)`. Against the doc: what a kind says besides
  its words is in `detail` (a skill's name and arguments; a report's sender; task notices; the files a note
  loads), and what an asking call asks is on its `ToolCall.ask`, not on the part.
- `ToolCall(id, name, input, action, paths, ask)`, `ToolResult(call_id, error, output, task)`, as the doc has
  them; `task` is a background task a result says started, resumed or was stopped.
- `words(text)` is new: the History outline and the actor list have only an event's text, not its payload.
- No `owns`, the doc's `recognizes`: ag records which harness made each call (`model_call.harness`), and a channel
  from before that has its harness recorded once, by the shape of its pieces, as its gatherer's old tables are copied
  (`harness`, step 6). The shape test lives there alone (migrate.py's `shape_of`).

`command` is the harness's own options for a session in a terminal (after `ag ... <name>`), `models` the models it
lists (Codex's catalog), and `answer_keys` / `answer_expected` / `answer_summary` how a question or plan it asks in its
terminal is answered by keys, what it then records, and the answer in a line -- each harness's dialogs described beside
its rules (Claude Code's `PLAN_KEYS`, Codex's). The dashboard's answers.py hands each question to its harness.

A `Follower` reads one record as it grows: `take(line, at)` gives the `Fact`s a line says, keeping what it needs
between lines (the queue, the questions open, the turn); `due(now)` gives what time alone decides (Claude Code: a
question's result with nothing after it for a second is answered, as Esc writes its note at once; codex: a
subagent's report, once its own rollout has it). `follow(path, follower, offset) -> (facts, offset)` reads the whole
lines past `offset`. Against the doc's `follow(path, offset)`: the follower is an object, since the facts need what
came before (which queued message a `dequeue` sends, which turn a question was asked in).

A session's name, given in the harness's own store: `rename(session, name, record, env)` -- Claude Code's a
`custom-title` line added to its record, as its `/rename` adds one; Codex's `thread/name/set` through its app server
(`codex app-server`), as its own /rename sends it -- and `rename_command(name)`, what to submit in its terminal so a
running session holds the name too (both harnesses' `/rename <name>`). Neither running harness hears of a name set
from outside: a running Claude Code writes the name it holds back into its record as the record grows, so a line
added beside it lasts only until then, and a Codex ag runs has no app server but its own (`--no-daemon`); its
terminal's `/rename` is what reaches it.

### Kinds

The doc's kinds, and five more the old rules told apart that the doc's list folded into others:

| Kind | Claude Code | Codex |
|---|---|---|
| USER, USER_COMMAND | the user's words; `! ls`, `/greet Bob` | the user's words |
| MID_TURN (new) | written while the turn ran, sent into it | none |
| ASK_REPLY | none | `<send_user_message_question_reply>` |
| AGENT, REASONING, TOOL_CALL, TOOL_RESULT | its blocks | its items |
| ENVIRONMENT | `<system-reminder>`, a system-role message | `<environment_context>`, AGENTS.md, developer messages |
| COMMAND_PROMPT (new) | the prompt a typed `/name` expands to | none |
| LOCAL_COMMAND (new) | `/context`, `/mcp`: run by Claude Code itself | none |
| COMMAND_OUTPUT | `<bash-stdout>`, `<local-command-stdout>`, /context's report | `<user_shell_command>` |
| ATTACHMENT_NOTE, INTERRUPT, SKILL | as the doc says | `<turn_aborted>`, `<skill>` |
| AGENT_REPORT, PEER_MESSAGE | a subagent's hand-back; another session's message | `agent_message` items (FINAL_ANSWER, or any other) |
| TASK_NOTICE, RETRY_NOTE | `<task-notification>`; its notes after a response went wrong | none |
| HOOK_FEEDBACK (new) | "Stop hook feedback:" and the like | `<hook_prompt` |
| TOOL_NOTICE | "Tool loaded."; tools added or removed (a system-role `tool_addition`) | `additional_tools` |
| COMPACTION_SUMMARY, COMPACTION_REPEAT | its summary (after its "others wrote" notice, #131), and what it sends again | its compaction item, and what precedes it |
| OTHER (new) | anything else of its own | anything else |

The adaptors map them as before: the user's kinds to `user_message`, the model's to their own types, every other
to `context`. A policy that wants skills or interrupts as types of their own subclasses the adaptor and changes
`event_types`.

## The events (step 2 and step 3)

**Conversation events** carry, as properties of their own, what the rules read of them: `kind`, `words` (the
user's words as typed), `action` (a tool call's) and `call_id` (a call's, or the call a result answers). The
adaptor declares them as `event_properties`; `call_ag` refuses any other. Against the doc: no launch-time check
changed. The server declares each on the event's type, optional, the first time it sees it, so no policy has to
declare them, and none is part of an event's identity.

**Records** (`ag/integrations/tools/ag_orchestrator/records.py`), inserted by the hooks with the server's
`insert`, in the session's own lane (#134):

| Type | Properties | Payload | Id |
|---|---|---|---|
| `model_call` | `read_id` | kind, harness, version (Codex's side calls: `source`) | new each time |
| `reply_part` | `answer_id` | the conversation event the part will be: type, payload, text, properties | answer id and place |
| `reply_end` | `answer_id`, `read_id` | stop | answer id |
| `call_failed` | `read_id` | status (499: the harness hung up, #133), error | its read |
| `recap` | | text | new each time |
| `name` | | text, by | new each time |

Against the doc's "Changes to ag's core":
- **No `records` declaration.** The store already registers a type the first time it sees it, and a policy loads
  only the types it groups, so the records needed no declaration and no launch check. A policy that put one of
  them in a group would see them; nothing refuses that yet.
- **`latest` takes `types`.** Claude Code's ids are chained from the channel's last stored events (#125); with
  records among them the chain would break, so the hook asks for the conversation's types alone.
- **The old ops are gone (step 6).** `pending`, `failed`, `recap`, `name` and `touches`, the tables they kept
  (`_pending`, `_recaps`, `_names`, `_touches`, `_reads.error`), and `call_ag.pending_ag` / `report_failed`. Pi's
  and OpenCode's plugins, which still kept their answers with `pending`, record them as the Python hooks do
  (`call_ag.ts`'s `answered_ag`: `reply_part`s and their `reply_end`) and each call as a `model_call` with their
  harness's name (`called`), in the records lane. An older file keeps its tables, copied into records once (below).

## The session-file watcher (step 4)

`SessionFiles` (`ag/integrations/tools/ag_orchestrator/session_files.py`), run by `ProxyHook.following` on each call
of a session (Claude Code: every call with its session id; codex: the thread's own turns), finds the harness's own
record of the session (`record_path`: where it runs, and the harness's own folder for the run), records that it
follows it (`session_file`), and reads it on every 0.25 s while it changes, inserting each fact as an event of the
session. Unchanged for an hour, it is followed no more until the session's next call, which reads on from where it
was; one not there yet is looked for every 0.5 s for 30 s (`claude -p` writes it only once its first call is under
way, and a run refused at that call makes no other), then again with the next call.

**Beside the session's reads.** ag's server answers a session's requests one at a time (its lanes, #134), and a
read can wait seconds for the policy's boundary check or a build. The facts go in a lane of their own beside the
session's (`insert` with `"lane": "records"`): no read depends on them, and policies never load them, so they need
order only among themselves -- otherwise a message queued, a question answered or Esc would show only once that
read was done (2-15 s, live). A hook server that starts reads each record from its
start, and the server stores nothing twice: an event's id is its line, by its place in the file and its bytes
(`<type>:<file>:<offset>.<crc32>`), so a file written anew has new ids.

**Where the record is.** A hook server is shared by runs, so the launcher puts the harness's own folder in its URL
when the run sets one (`/c/<folder, base64url>/`, after `/r/`: CLAUDE_CONFIG_DIR, CODEX_HOME), as the doc asked;
without it the hook looks where the harness would by default.

**The facts** (harness_kit's `Facts`; each payload has `at`, when the record says it happened):

| Type | Claude Code's record | Codex's rollout |
|---|---|---|
| `message_queued` | `queue-operation` enqueue (not its own notes) | none |
| `message_sent` | remove `absorbed_mid_turn` (`mid_turn`), dequeue (`next`, `joins` when held), a `human` user line between turns (`prompt`) | none |
| `message_withdrawn` | any other remove; `popAll` (Up: every message written back in the prompt, to edit) | none |
| `asked` | none: its asks come with the reply (`derived`, below) | `request_user_input` (and `_async`); a completed Plan-mode turn's plan, `plan:<turn>` |
| `ask_settled` | an asking call's result: `dismissed` when the interrupt note follows, else `answered`; its result's words | the call's output (`aborted by user`: dismissed); async replies, once every question has one; the turn's end; for a plan, the next turn's start and what it opened with |
| `turn_stopped` | `isApiErrorMessage` (`error`, its status); the interrupt note (`interrupted`) | `task_complete` (`over`, or `error`), `turn_aborted` (`interrupted`) |
| `task_started` | none: its starts come with tool results (`derived`, below) | a subagent started; a command left running |
| `task_ended` | a `<task-notification>` that ends one, the moment it is written | a subagent's end (with its `report`), a command's |

The doc's `question_settled`, `turn_interrupted` and `gave_up` are `ask_settled` and `turn_stopped`'s `how`. Codex's
async question has a result only once every question it asked has its reply (the dashboard read each reply as it came).

A turn's stop counts only while no call began after it: the dashboard takes the newest of ag's newest read and the
newest message ag stored (`data.began`) -- a message is stored as a read begins, before its context is built and the
read recorded. Not the answer's end: agy cancels the step an answer makes as the answer ends (Esc pressed as it
came), while the hook server stores that end, ms apart and either first. The same goes for a hang-up (`since_said`): codex hangs up a call to send a question's reply at
once, and Claude Code's message taken back on Esc is withdrawn with its read.

**The dashboard** reads them through `data.Record` (`record_of`: an actor's newest 400 facts) and `typed` /
`meanwhile` (its message facts): what is asked and settled, a turn stopped, background tasks ended (and, for codex,
started), what the user wrote as it worked, a subagent's report. `queued.py`, `rollout.py`, `data.settled`,
`stopped` and `_ends`, and `live.py`'s watching of record files are gone: a fact's insert rings the page through ag's
notifications. GIVE_UP_LONG now applies where the record is followed (`Record.followed`). Since step 5 it reads
no file of the harness's for a channel whose hook derives (below): a task's output file's time and Claude Code's plan
file are the hook's to read.

## Derived and dashboard events (step 5)

**Derived from calls and answers** (`Harness.derived`; ProxyHook's `derive`), recorded beside the session's reads,
each by the harness's own ids (`<type>:<key>`):

| Type | Key | When |
|---|---|---|
| `asked` | the asking call's id | an answer ends with a call of ASKS (Claude Code's AskUserQuestion, ExitPlanMode); a plan's text read from the plan file the session wrote (`plan_text`) |
| `ask_settled` | the asking call's id | a call carries its result: `dismissed` when it is an error and the interrupt note comes with it (Esc rejects the call), else `answered` -- a plan sent back with what to change is an error too, with no note, and its turn goes on. The session-file watcher records it as well (above): this one is the sooner once a call goes out, the watcher's the one for Esc, which makes no call |
| `task_started` | `<task>.<call>` | a tool's result says a background task started or resumed (`task_of`), labelled by its call (`label_of`) |
| `task_ended` | `<task>.<call>`; `<task>.<crc of the notice>` | a task stopped (TaskStop); a notice that it ended; an agent's report handed back |
| `task_activity` | `<task>.<crc of the notice>` | a monitor's event; an agent waiting on its own background work |

An answer's are read once it is whole; a call's from its last answer on (the results and notices that came after),
less the asks, which its answer recorded. Codex's asks and tasks are its rollout's (`asks_recorded`). Each model call
says `derives`, so the dashboard knows a channel's hook records them and reads them in place of looking through the
answers' calls and the events' texts (`Record.asking`, `Record.tasks`); a channel whose newest call does not say so
keeps the readers it had, until step 6. The session-file watcher looks at each running task's output file every 5 s
(`task_activity`, by the file's time), so the dashboard reads no file to know a task lives. The dashboard reads a
channel's activity apart from its other facts (the newest 200, beside the newest 400 others), so a task that writes
all along never pushes its own start, or what is asked, out of what is read.

**`file_touched`.** What each call did to files (file_touches/) is recorded as `file_touched` events (`<call>:<how>:
<path>`, property `call_id`) beside the session's reads, in place of the `touches` op and `_touches`, which stay for
older hook servers until step 6; the dashboard reads the events, and the table for a call with none. The checks read
calls and results by the harness's rules (`read`'s `tool` and `result`): on the 9,344 calls of the last 60,000 events
in making_ag both readings agreed, but for 15 ToolSearch results, which touch no files.

**The dashboard's own** (actions.py), put in by ag (`ag home insert`), in the background, while a server runs the page:

| Type | Payload | Read by |
|---|---|---|
| `chat_sent` | text | `data.typed`: pending (`chat`) until a message of its words is queued, sent or stored, at most 60 s -- not a "/" command, which the harness runs itself; the page that sent it shows it pending until the harness has it. A new codex session's waits for its thread's id (`sessions._rename`) |
| `answer_given` | call, summary, expect | `data._with_started`: the answer and whether it was recorded, past a restart |
| `terminal_input` | | `sessions.answer`'s check that nothing was typed since a question was asked: one per burst of keys (2 s quiet) |
| `actor_message` | kind, to, to_name, text | `files.files`' `sent`: a message the actor sent another of its gatherer (`ag actors send`; `new`, a new actor started with it), shown in its turn in Chat; the receiver has it as a message of its conversation, in its envelope (coordination.py) |

**After merging:** the hook servers must restart (`ag stop`, then any session's next run) for a session's record to
be followed. Until then the dashboard sees no facts for it -- no queued messages, questions settled in the terminal,
Esc or given-up calls -- and falls back to time alone for a failed call (GIVE_UP_SECONDS).

## The hooks: one ProxyHook

`ProxyHook` (`ag/integrations/tools/ag_orchestrator/proxy_hook.py`) holds what both hooks did alike: recording
every call (`model_call`), a reply's parts as they stream and its end (`reply_part`, `reply_end`), a failed call
(`call_failed`), a side call's recap or title (`side_answered`), and the files a call touched (`before_end`).
Each subclass keeps its own flow: Claude Code's continuity of ids, claims, counting, suggestions and compaction;
Codex's runs, side calls and compaction. On a hang-up (499) the Claude hook also withdraws what the call stored
(#133). From each call of a session on, it follows the session's own record (`following`, the watcher above).

## The old tables (step 6)

What ag kept before its hooks recorded it as events is copied into records once per gatherer, so the dashboard
reads records alone. The core keeps its tables and knows no harness: its server serves what they kept (`old_tables`:
the rows of `_recaps`, `_names`, `_touches`, `_pending`, `_reads.error` and each channel's newest `_reads.answered_at`,
and for a property given, `by`, each of its values with the record types it has and its first pieces), takes events
with the time they happened (`insert`'s `at`, stored in one transaction) and keeps that the copy was made
(`migrated`, its `_migrated` table). The harness side does the copy (`ag/integrations/tools/ag_orchestrator/
migrate.py`, a program on ag's server's client): each row as the record the hooks would have made, by the same id
(`file_touched:<call>:<how>:<path>`, `failed:<read>`, an answer's `reply_part`s and `reply_end`), skipping a channel
that has records of that type already, and for a channel with no `model_call`, its harness by its pieces' shapes
(`harness`, migrate.py's `shape_of`). A dashboard that serves the page runs it for each gatherer that still has the
old tables (`migrating.py`), in the background. On the real `making_ag` (763 MB) it copied 10,483 file touches, 33
recaps, 68 pending parts, 92 failed calls and 87 channels' harnesses in about 6 s; the dashboard then read each actor
as it had read the tables, but for the background tasks a hook server not yet restarted had not recorded.

## The dashboard

It reads records alone: what is pending (`replies`: `reply_part`s after the newest conversation event, ended or
not; a part that broke off is dropped at the next turn's call), whether a turn is over, a failing or hung-up call
(`call_failed`, by its read: `_newest_reads`), the recap, the name, the harness (`model_call`, else `harness`),
what is asked and its tasks (`Record`), what calls did to files (`file_touched`). Since step 6 its fallbacks are
gone: a channel whose hook has not recorded something (a hook server not restarted since) shows none of it, and
`data.parts` reads a piece by its channel's harness, not its shape. It leaves records out of every view of the conversation (`NOT_RECORD`). The user's
words come as typed, with their kind, from the `words` and `kind` properties, else from `Harness.words`; the page
no longer parses Claude Code's or Codex's wrappers.

Since step 4 it reads no harness's record of a session: the hooks record what those say as facts (above); since step
5 no plan or output file either, where a channel's hook derives.

It writes one event of its own so far, through `ag home insert` (the server's `insert`, run as `ag home build`
is): an actor's name, as the reader gave it (`name`, by "user", `naming.py`), which the list shows ahead of the
harness's. It also gives the name to the harness (`Harness.rename`), and to a session in its own terminal by
typing the harness's `/rename` once its turn is over (`sessions.py`'s `rename`): typed mid-turn, the Enter could land
on a permission prompt.

## Order of work

The doc planned a PR per step. Steps 1–3 went into one PR: they were built together while `main` moved under them
(#127–#137), and the dashboard reads the records only once step 3 inserts them.

1. **Built.** The harness package, the rules moved as they were; one shell parser (`harness_kit/shell.py`).
2. **Built.** Conversation events carry `kind`, `words`, `action`, `call_id`.
3. **Built.** Calls and replies as records; `ProxyHook`.
4. **Built.** The session-file watcher in the hook server (above); `queued.py`, `rollout.py` and the dashboard's
   session-file reads gone; the harness's folder in the hook server's URL (`/c/`).
5. **Built.** Derived and dashboard events (above): `asked`, `ask_settled`, `task_*` from calls and answers,
   `task_activity`, `file_touched` (its calls read by the harness's rules), `chat_sent`, `answer_given`,
   `terminal_input`; `answer_keys`, `command`, `models`. A channel's asks and tasks are read from events. The
   dashboard writes its own action events itself (decided 2026-10-26).
6. **Built.** Old tables copied into records once (above); the dashboard's fallbacks, `Harness.owns` and
   `harness_of`, and the old ops gone; Pi's and OpenCode's plugins record their calls and answers.
7. **Built.** Fixtures per harness version: `tests/fixtures/harnesses/<harness>/<version>/` holds a live session's
   model calls (one of each kind, headers and trimmed bodies), its longest conversation and the harness's own record,
   with what harness_kit reads of them (`expected.json`: calls, parts and `words`, derived facts as the hook runs
   `derive`, the follower's facts, answer keys). `tests/test_harness_fixtures.py` checks every version; a new version
   is a new folder, and older ones must still read as they did (`tests/probe/rewrite.py` rewrites a reading on
   purpose). `tests/probe/probe.py <harness>` makes a folder from a live run: the harness's command wrapped so a tap
   records each call as sent, the session driven through the dashboard's API through every feature, the API error by
   the tap refusing a message's calls, and what it did not trigger said. Claude Code 2.1.311 and Codex 0.164.0 are
   captured. Their readings found two rules to fix: Claude Code 2.1.311 wraps a task's notice in a reminder, read
   as `environment` (now `task_notice`, which opens a turn); and codex's async question, as its rollout records it
   (`{title, options: [label]}`), was not taken by `answer_keys` (`picked` takes it now). A notification is seen
   twice in Claude Code's record -- queued, then sent as the user's -- and recorded as two `task_ended`, which read as
   one. Claude Code 2.1.314 is captured too, with skills loaded (a bundled one, one on disk, a /name typed): a bundled
   skill with no files of its own (artifact-diagramming, keybindings-help) has its instructions sent bare after the
   Skill tool's result, with no base directory, read as the user's words (now `skill`, by where they are: `launched`).

## Antigravity (agy)

`harness_kit/antigravity.py` and `ag/integrations/harnesses/antigravity/`, read from agy 1.4.12. ag hooks agy on its
Gemini API route (`modelProvider: "gemini"`, GEMINI_API_KEY, GOOGLE_GEMINI_BASE_URL: its 1.1.13 changelog), not the
Cloud Code API it calls when signed in with Google. Its calls are the public Gemini API's
(`streamGenerateContent?alt=sse`), which trace.py now reads (`gemini_response`). Nothing in its headers names a
session or what a call is for: its system instruction's <user_information> names the conversation and the working
directory, and its title call (TITLE_PROMPT, before the first turn's call) is matched to its conversation by the run
(`/r/<pid>`) once its answer is back. Each part of its contents is one item and one event, as agy itself sends them
back. Built: the hook (events in, context back, `model_call`, `reply_part`, `reply_end`, `call_failed`, the title as
`name`, `file_touched`), the launcher, `command`, and the dashboard starting it in a terminal (sessions.py: renamed
to its conversation as a codex terminal is; its first message as `--prompt-interactive=`, `first_prompt`).

Read from a capture of agy 1.4.12 (onboarding, questions, a background command, a subagent, `/compact`, Esc, an
error, `/rename`) and built on it:

- Subagents: a call whose system instruction holds a `<subagent_reminder>` naming its caller is `SUBAGENT`, its
  session the caller's: let through as it is and recorded on the caller's channel, as Claude Code's. The subagent is a
  background task of its caller: started by `invoke_subagent`'s result (its conversation id, its transcript the
  output followed), active by its messages to the caller (`AGENT_REPORT`, Chat's report note), ended once its own
  answer calls no tool, resumed when it is called again.
- Compaction: its last content the continuation-summary prompt (`COMPACTION_PROMPT`) is `COMPACTION`; the hook
  builds in its place as codex's (the server's `compaction`, ag's context read only, agy's prompt last). The
  `<CONTEXT_SUMMARY>` its next calls open with is `COMPACTION_SUMMARY`, not stored.
- `ask_question`: `asked` from the answer, `ask_settled` from its result ("A<n>: ..."; "User Skipped" on Esc -- agy goes
  on either way). Its dialog is answered from the page (`answer_keys`: arrows, Space for several, "→" to the next
  question, Enter; "Write-in..." after the options). `box`: a ">" row between two rules, the cursor hidden while a
  dialog (a question, a permission, its folder trust) has the keys.
- Background commands: `run_command`'s "Tool is running as a background task with task id" starts one; the
  SYSTEM_MESSAGE `Task id "..." finished with result` (`TASK_NOTICE`) ends it.
- Its record, `conversations/<id>.db` (SQLite, a row per step whose status changes in place, protobuf payloads): a
  `Follower` that reads a database (`database`, `read_on`, `stamp`, `anew`); an ERROR_MESSAGE step is `turn_stopped`
  "error" with its text and HTTP status; the name in `annotations/<id>.pbtxt` is `name`. Esc and the queue of messages
  typed during a turn are not in it: the hook server sees Esc (a hang-up), and agy sends a stopped turn's message
  again with the next, so nothing is taken back.
- Renaming (`/rename <name>`, and the annotations file), its models (`agy models`, with the key its config entry
  sets), and a run's instructions: agy takes none, so the launcher takes `--append-system-prompt` and its hook adds
  the text after the system instruction of each of the run's calls (`told.py`, by `/r/<run>`).

Not yet: its headless mode (`agy -p --output-format stream-json`), its permission prompt shown as waiting (the
dashboard shows the actor running while agy asks to run a command), and a fixtures folder (`tests/probe` drives
Claude Code's and Codex's terminals).

## A new harness, the dashboard untouched

The test: a harness is added by its module here (its `Harness` subclass, its mark in `marks/<name>.svg`, its line
in `HARNESSES`), its integration in `ag/integrations/harnesses/<name>/` and its entry in `harnesses.toml` -- no
file of `ag_dashboard/` changed, nor a shared one (`shell.py`, `file_touches/check.py`, `proxy_hook.py`). agy's two
PRs (#186, #191) had to change `sessions.py`, `data.py`, `files.py`, `coordination.py` and `page.html`: each such
change is a fact of the harness to move here, read by the dashboard through a field every harness has. In steps:

1. **Built.** How a harness looks and its terminal behaves: `label`, `mark()` (an SVG file, its logo on its
   colour), `fullscreen` and `screen_env` (the screen the dashboard's terminal runs it in), `picks_session_id`
   (started under an id of ag's, renamed to its own), `esc_takes_back` (Claude Code's message put back in its box),
   `stopped_says` (its words for a turn stopped short), `runs_in_terminal`; `rename` finds its own record from `cwd`;
   `DEFAULT`, the harness of a session that names none. The home carries them (`harness_info`, `data.py`), so the
   page names no harness for its logos, badges, lists of what can start or be messaged, terminal screen or stop
   lines. Pi and OpenCode are here by name and look alone (`Named`): their rules are their TypeScript adaptors'.
2. **Built.** One view of a conversation for every harness (`data._view`), from the `Part`s its rules read
   (`read_one`; `kind`, the Kind a piece was stored as, for a piece its neighbours decided: Claude Code's bare skill
   instructions): a call (`ToolCall.calls`, a script's calls: codex's code mode), a result, thinking (`detail`'s
   `thinking`, else its text), an attachment (`Part.attachment`), the user's or the model's words, and the harness's
   own text a note. A note carries what its rules read of it (`said`: its Kind and detail), and Chat takes reports,
   messages, skills, commands, `!` output, interrupts and the files a note loaded from that (`files._note`,
   `_interrupted`, `_loaded`), not from each harness's text rules. A channel whose harness is not known reads its notes
   by `DEFAULT`'s rules. A row stored under older rules draws as its rules read it now (a safety classifier's note,
   stored as the user's before #114, is Claude Code's own).
3. Tools by shape.
   a. **Built.** Each harness reads its tools' input into a view (`ToolCall.view`: a `Shape` -- read, write, edit,
      patch, shell, search, web, agent, todo, skill, ask, script, other -- with its fields, its `title`, and `arg`,
      `description` or `label` where its shape's own does not do), and its output's own lines about the run off
      (`Harness.tool_output`: `ToolResult.shown`, `exit`, `took`). The page's summaries (`SHAPES`), its call view and
      its shell command go by the view; Chat's labels, the files a call read and changed, its work kind (`work.doing`:
      `Action` and shape) too. A subagent a call started is the harness's to say (`spawned`), and a script's calls'
      results (`script_results`). `Action.PUBLISH` for a tool that publishes (Claude Code's Artifact).
   b. **Built.** ag's file checks read each call as its harness's rules do (`ToolCall`: its view and `Action`), not by
      tool names and input keys: `check.py` (what a call names, reads, writes and says it changes), `calls.py` (calls
      and results by the harness's rules -- else whichever harness's rules find calls among the items --, a result's
      output as `shown`, a script's calls by `script_results`, the last results by the parts' kinds). `shell.py`'s
      SHELLS, EDITS and `_shell_text` are gone; `ToolCall.server` marks a tool the provider ran.
4. **Built.** One status rule for every harness (`data._status`: `_claude_status` and `_codex_status` joined,
   `RECORDED` gone), its differences the harness's: `record_ends_turns` (its record ends a turn no call of ag's did:
   codex's), `esc_takes_back`. What it asks, one view (`ask_view`: a question's title, an option given as its label
   alone, read as such) and one rule (`_asking`: what the turn waits on, else a question asked as it goes on; its turn
   over, a plan it offers). `asks_shown_again` (a terminal opened after it asked still asks it), `messages_answer_asks`
   (a message typed into its dialog would answer it: the server's `dialog`), `ask_says` (the plan card's buttons and
   words) and `reply_block` (codex's proposed plan, drawn as a card) are the harness's.
5. **Built.** Running headless: `headless` ("session": one process, a message a line, Claude Code's stream-json;
   "turn": a process per turn, `codex exec`; None: a terminal), `headless_args`, `headless_message` and
   `headless_event` (a turn's end, an error, the session's own id); sessions.py's two runners name no harness.
   DocWriter's and the Browser's tools (`mcp_args`), and DocWriter's guard on the harness's own edits
   (`edit_guard_args`, `guard_path`, `guard_refusal`: Claude Code's hook). `own_folders` (the harness's own folders,
   not an actor's file changes: agy's now too) and `memory_folder` (its memory of a directory: Chat's "memory/" and
   the Editor's badge). `saves` and `save_files` (where History saves an AGENTS.md, a skill or memories for it, its
   paths and formats: Claude Code's alone so far); the Save panel offers each harness that has a place for the kind.
6. **Built.** `tests/test_harness_untouched.py`: the dashboard's code names no harness (its Python read by tokens, its
   page's script line by line; comments and docstrings aside; what is left, and why it is no harness's rule, listed);
   and a toy harness, registered from outside (`harness_kit.register`) before the dashboard loads, is listed (runnable,
   available, its looks), its own folders, session variables and memory folder known, started headless (a fake ag
   for it), and drawn -- its messages and calls in the Transcript's parts, its commands and files in Chat. Found on
   the way: Claude Code's session variables (`session_env`), stripped from what the dashboard starts, and the Editor's
   shortened memory folder (`memory_folder`'s group).

## Open questions

- Sessions run outside ag's launcher: the watcher learns a session's file from the launcher's URL.
- How often `task_activity` is recorded: every 5 s at most from a task's output, for now.
- `terminal_input` granularity: one per burst (2 s quiet), enough for the typed-since check.
- `codex exec` exits once it has its final answer, before the hook server is through with it, so since #133 that
  last call is recorded as a hang-up (499) and the run shows as interrupted rather than over.
- Pi and OpenCode: their plugins record each call and answer (step 6), none of the facts the Python hooks derive
  or follow -- their asks and tasks are not known.
