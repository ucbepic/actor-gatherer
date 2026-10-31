# Dashboard: future work

## Waiting for you

An actor shows as waiting for the user when its latest answer from the model calls `AskUserQuestion` or
`ExitPlanMode` and no result has come back yet (data.py's `asking`). It stops waiting once Claude Code's own
record of the session has the call's result (`settled`). Where the dashboard runs the session's terminal, the
note under the chat answers it: the keys are worked out from the tool call (answers.py) and typed into the dialog
one at a time (sessions.py's `answer`).

Not detected yet: the actor shows as Running while Claude Code waits.

- [ ] **Permission prompts** ("Do you want to proceed?"). They never appear in what ag records. Claude Code's
  `Notification` hook fires with `permission_prompt` when the dialog opens. ag's launcher could add that hook
  for the run with `--settings`: it runs alongside the user's own hooks without replacing them, and it can POST
  to the hook server ag already runs. The wait ends at the next model call, when a hook says the tool ran,
  failed or was denied, or when keys are typed into the dashboard's terminal.
- [ ] **Other dialogs**, such as an MCP server asking for input (elicitation). The same hook may cover some.
- [ ] **Codex's approval prompts** ("Would you like to run the following command?"). Codex writes nothing of them to
  its rollout file, and ag records only the model's call asking for `require_escalated`. The dashboard runs codex
  with `--approve-for-me`, which sends them to codex's reviewer, so its own terminals never show one; a codex run
  elsewhere with another approval policy does. Codex 0.164 has a `PermissionRequest` hook (hooks.json), which may
  be the way in, as Claude Code's `Notification` is for its permission prompts.

### Codex

Codex asks in three ways, all read from its own record of the thread (`<CODEX_HOME>/sessions/.../rollout-<time>-<thread>.jsonl`,
written as codex goes; followed by ag's hook, harness_kit.codex's `Rollout`, what it says recorded as events) and answered by keys typed into the dashboard's terminal (answers.py):

- **A question** (`request_user_input`, Plan mode's; its turn waits): from ag's pending answer, as Claude Code's
  are, until the record has its output -- answered, or "aborted by user" (Esc). Single choice only: codex adds "None
  of the above", with a note in the user's own words.
- **A question asked as it works** (`request_user_input_async`): shown while that turn runs, the actor still Running.
  Once the turn ends it can no longer be opened in the terminal, and the user simply writes back.
- **The plan a Plan-mode turn proposed** ("Implement this plan?", drawn once the turn is over): shown only where
  the dashboard runs the terminal, it opened before the plan, and nothing was typed into it since. Codex records
  neither the prompt nor its dismissal (Esc), so outside that the plan is not known to be asked about. A message
  from any view while it is asked is "No, stay in Plan mode" plus the message (server.py's `codex_dialog`): typed
  as it is, its Enter would have implemented the plan. A message while codex waits on a question there is refused.

Not covered yet:

- [ ] **"Yes, clear context and implement"** (the plan's choice 2) starts another thread: left to the terminal.
- [x] **Codex's wrappers in the Chat view**: a `<proposed_plan>` is drawn as a card headed "Proposed plan"
  (page.html's `markdown`), and the answers to what codex asked as it worked as "question → answer" (`asked`), part
  of the turn that asked (files.py, harness_kit.codex's `replies`).
- [ ] **A question in a codex terminal outside the dashboard** is shown but not answerable, as Claude Code's are.
- The keys are codex 0.164's. As for Claude Code, what codex records is checked against what was picked
  (`recorded`), so a change shows up as a warning.

Shown, but not answerable from the page:

- [ ] **The message-box sessions** (`claude -p --input-format stream-json`, with no terminal). It is untested
  what Claude Code does with `AskUserQuestion` there.
- Sessions in a terminal outside the dashboard: answered there. Nothing can type into that terminal.
- A dashboard terminal with keys typed into it since the question appeared: finished there, because the
  dialog may no longer be as it first showed.

Choices the note does not offer yet (each needs one short live test of its keys):

- [ ] "Chat about this" on a question: the option two past the last one. It rejects the question and the model
  asks what to clarify.
- [ ] The user's own words on a multi-choice question. How "Type something" combines with the ticks is unknown.
- [ ] Approving a plan with feedback (Shift+Tab). Editing the plan (Ctrl+G) opens Vim in the terminal, so it is
  left to the terminal.

Assumptions to check against new Claude Code versions:

- The dialog's keys, and the three plan choices, are the ones Claude Code 2.1.310 shows (answers.py). The page
  checks what Claude Code records against what was picked (`recorded`) and warns on a difference, so a change
  shows up as a warning rather than a wrong answer passing silently.
- The session record (`<config>/projects/<dir>/<session>.jsonl`) and the plan files (`<config>/plans/`) are read
  from the dashboard's own `CLAUDE_CONFIG_DIR`. A session run with another config dir keeps showing its question
  until its next model call, and shows no plan text.

## Stopped on an error

A model call that fails is kept on its read (`_reads.error_status`, `_reads.error`) by ag's hook server, whether the
endpoint answered an error or could not be reached; one that got no answer at all is answered 502 with why, where
the harness would otherwise get a bare 500. The actor shows Running with a note while the harness tries again
(data.py's `failing`), and Error once it gives up: Claude Code's record of the session ends with its API error
(`stopped`), or no try comes for GIVE_UP_SECONDS -- Esc while Claude Code waits to try again stops it without a word
in its record. The same record shows a turn the user
interrupted (Esc) as Idle, where ag's record would go on running. Chat says under each turn how it stopped short, in
its harness's own words (files.py's `stopped`, page.html's STOPPED_SAYS): Claude Code's "⎿ Interrupted · What should
Claude do instead?", codex's "■ Conversation interrupted" (less its pointer to its /feedback; and its "■ Goal
budget reached - the turn was stopped.", by its record's `reason`) -- from that record or from the note the harness
sends the model with the next message ("[Request interrupted by user]", codex's `<turn_aborted>`); or the error it gave
up on, in its words, from the record.

Not covered yet:

- [ ] **An answer the endpoint breaks off once it has begun** is not kept as a failure. The harness hanging up is
  now told apart (see "Stopped before the answer"); the endpoint breaking off is not. Claude Code's record still
  shows the give-up; for codex it shows as Running until its next call.
- [x] **Codex's own record** (its rollout file, followed by ag's hook) is read: a turn that gave up (`task_complete` with an
  `error`) is Error at once, one interrupted (`turn_aborted`) or completed with no call ag saw is Idle.
- [ ] **Calls with no read** (Claude Code's compaction, recaps) are not kept when they fail.
- [ ] **A session whose record is elsewhere** (another `CLAUDE_CONFIG_DIR`, another machine) waits GIVE_UP_SECONDS
  for Error, and an interruption there is not seen.

## Stopped before the answer (Esc)

Esc before any of the answer's text has come: Claude Code puts the user's message back in its input box, writes
nothing to its record, and drops the call. ag's hook server sees the harness hang up (`hung_up`, looked at every
0.25 s while the model is quiet): the call is not sent on, or is broken off, and is kept on its read as 499. The
actor shows Idle (data.py's `hung_up`). The events the call stored are withdrawn (`_withdrawn`, the server's
`withdraw`): in no read, not in `latest`, and not in Chat, until the harness sends one again -- as Claude Code does
when it kept the message (Esc once some text had come). A message sent from the Chat right after such an Esc first
empties Claude Code's input box with Ctrl+C (sessions.py's `took_back`), so it does not go out joined to the one
put back.

Not covered yet:

- [ ] **Idle only once ag's read for the call ends.** The hook reports the hang-up with the read's id, so a call
  stopped while ag still reads waits for that read: seconds on a busy gatherer. The hang-up could be kept at once
  and tied to its read after.
- [ ] **Claude Code's rewind** (Esc Esc, /rewind): the conversation goes back to an earlier message and on from
  there. The Claude adaptor's Continuity finds the fork (`carry_on`'s "rewind": the user's words right after a run
  of stored pieces where the stored history went on otherwise; the hook logs it) and goes on from there, so the new
  message is stored and sent, even where Claude Code's notes follow it as they followed the old one. But ag keeps
  the branch left behind in every later context: the stored branch after the fork would be withdrawn.
- [x] **Codex, stopped before the answer:** the call is kept as 499 and shows Idle, and nothing is withdrawn -- rightly:
  codex keeps the message, its answer begun or not, its message box left empty, and says so ("■ Conversation
  interrupted - use /feedback if something went wrong"; its tui's `on_interrupted_turn`, 0.164; read in its source,
  not live).
- [x] **A message taken back goes back in Chat's message box**, as Claude Code puts it back in its input box, and out
  of the conversation (data.py's `taken_back`: the newest user message withdrawn with the newest call, hung up on). The
  hook withdraws a call's events on ANY Esc, and what the call sent again of the turns before with them; Claude Code
  keeps all of it once the answer's words had begun, and records the turn interrupted. The hook server says what of the
  answer it had relayed when the harness hung up (`call_failed`'s `reached`: "nothing" -- nothing, or only thinking --
  "tool", "text"), so "nothing" is taken back and "text" kept at once; a tool call begun with no text (or a hook from
  before `reached`) waits for Claude Code's record, followed, to say nothing of the turn being interrupted after the call
  went to the model (its read) for TAKEN_SECONDS (`withdrawn_reads`). Chat hides only the message and what came after it
  in the call. While it is untouched in Claude Code's input box (the Esc the last key typed into its terminal after the
  call before: the session's `stopped_at`, the page's `untouched`), it is put in Chat's message box, as the actor's
  draft, once and only where nothing is written; once it is not there untouched -- sent or changed in the terminal, its
  process gone -- it is taken out of Chat's box again, if still as it was put. Sent from Chat, Claude Code's box is
  emptied first. Codex takes none back (see above).
- [x] **Esc in Chat** interrupts the turn, as in the harness's own terminal: typed into the session's terminal, from the
  message box in any view, or from anywhere else on the page that does not take it, for the actor of the pane in focus,
  in Chat -- the list, a turn or a button clicked included (#176 took it from the box only, and an Esc after such a
  click did nothing at all); not with a panel, a menu, a dialog or the settings open, nor typed in another box, the
  Editor or a terminal. Only while the actor runs or asks (its own status, not a build of its context) -- an
  idle Claude Code takes Esc twice for its rewind, and one starting, for "No" to trusting its folder -- and while it
  asks, from the message box only: elsewhere Esc would dismiss its question. Typed while the dashboard's own keys go
  in (a message pasted, an answer), it waits for them (sessions.py's `type`). A session the dashboard runs no terminal
  for (another process's, or the per-turn process of `[dashboard] chat = "headless"`) cannot be interrupted from Chat.
- [ ] **`took_back` knows only keys typed through the dashboard's terminal**, and relies on Claude Code 2.1.310
  emptying a non-empty input box on Ctrl+C (on an empty one it only says "press again to exit": never send two).

## Sent at once, in Chat

A message shows as sent the moment Claude Code sends it: ag's hook reads the line Claude Code writes to its record
as it does (`{"type": "user", "origin": {"kind": "human"}}`), every 0.25 s while the record changes, and records it, and the Chat
view draws it as its turn's first, with the actor at work, until ag stores the turn (data.py's `_unstored`).

Not covered yet:

- [ ] **Codex:** a message stays "Pending" until ag stores it. Codex's rollout file has the user's message as codex
  sends it, and could give the same.
- [ ] **The actor list's other actors** turn Running only when ag stores their message: Claude Code's record is read
  only for the actors a page shows.
- [ ] **In the event-based design**, "sent" would be an event the harness's adaptor writes. It must not wait in the
  gatherer server's lane behind the session's read, or the lag comes back.

## ag's server: what a model call waits for

Each session's requests run in a lane of their own (server's `serve`): one session's in order, sessions side by
side, so a read that waits for a check or a build holds only its own session. The file poller's watch leaves out
events with no text and searches each text once (file_changes.py's `names_in`): a read in making_ag went from 6.1 s
to 0.36 s.

Not covered yet:

- [ ] **A side call's context is read from a whole copy of the database** in memory (manager.py's `context_only`): in
  making_ag about 470 MB, and seconds, for every prompt suggestion and recap -- one at a time in the process. It could
  be read in the database itself and the policy's writes undone (a savepoint, rolled back).
- [ ] **Each request sets the manager up again:** `Manager.init` opens a connection and runs the schema's setup, and a
  new manager runs it again on its first use (`_conn`): about 60 ms an op, 5-6 ops a model call (measured before the
  lanes).
- [ ] **`history.rows` reads the whole events table**: its `(p_channel = ? OR p_channel IS NULL)` can't use the index
  (0.07-0.5 s a read in making_ag).
- [ ] **The watch's raw part reaches back to the oldest of every channel's latest reads** (row 374 of 24.7k in
  making_ag): one idle channel keeps nearly the whole history in it. Only channels read lately would cut the first
  watch from 1.4 s to 0.12 s, but a change to a file named only by an idle channel would go unreported.
- [ ] **A user message's read still waits for its task-boundary check** (sync_seconds), by choice: 3.2 s on average
  in making_ag, and 2 of 102 checks found a new task. Lanes keep it to the session.
- [ ] **A plugin poller holding something tied to the thread that made it** (a sqlite connection opened in its
  `__init__`) fails when another lane asks it.

## Context sizes: ag's count and the provider's

ag sizes every event and made item with its own tokenizer (tiktoken's o200k_base) when it stores it. After the call,
the Claude hook asks the API's count_tokens (counting.py) and stores Claude's count in its place (`counted`). A
read's size is the sum of what is stored at the time. The dashboard shows it beside the provider's count of the call.

Not covered yet (found 2026-10-26, on a90fe776 and 85d66f98 in making_ag):

- [ ] **Events older than a call's own are never counted.** `Counter.steps` counts at most STEPS_PER_CALL (25) new
  steps a call, and `event_ids` matches the request's blocks only to the events that call sent ag (`out["events"]`:
  the new ones and the ~20 stored before them). So "the rest after the next ones" never happens: anything a call
  stores beyond 25 steps keeps its tiktoken size for good. On 85d66f98, 143 of the 175 tool calls (and as many
  outputs) a resume stored were still uncounted hours later, ag about 94k under the provider. The store already
  names a context's uncounted events (`uncounted`); they need matching to the request's blocks by their stored ids.
- [ ] **What is not counted yet is ~35% low.** Claude makes 1.17-1.59 tokens per tiktoken token here, by kind
  (tool calls and output ~1.5, ag's sections ~1.3). Each call's newest events are low until counted, and a
  session's first call is low throughout: a90fe776's was 80.7k by ag's count, 100.7k by the provider's. A factor
  per gatherer and harness, learned from its counted items (Claude's count over tiktoken's), would size the
  uncounted ones.
- [ ] **Section budgets are in tiktoken tokens** (layout.py's `every_earlier_request`, `related_tasks`, `clip`), so
  by Claude's count every section is over its own: a90fe776's join build held "Every earlier request" to 40k at
  27.1k (35.2k by Claude's count) and its related tasks to 15k at 15.5k (21.6k). The same factor would bring them in.
- [ ] **The actor list and the monitor drop by the preamble while a call is out.** They show `real_tokens ??
  sent_tokens`, and `_agents`' `sent_tokens` (data.py's `_sent`) adds up the read's items only, without the tools
  and system prompt. Until the provider's count comes (1-4 s), an actor shows ~30k less, then jumps back: a busy one
  flickers. The Context view has it right (`counted_tokens`: `_reads.sent_tokens`, the preamble in it); the list
  and the monitor could show the same.
- [ ] **A hook server keeps running the code it started with, and nothing shows it.** 85d66f98's (:4122) started
  at 08:19, a minute before the checkout pulled #125 (ids from the stored history). Its resume at 12:50, with a
  message taken back by Esc, still went through the in-memory Continuity, which stored the session's history again
  (584 events, ~350k tokens; removed by hand, a backup kept). The hook server and ag's server could log, and give
  the dashboard, the commit they run, and the dashboard could say when one runs older code than the checkout.
- [ ] **Before its compaction, 85d66f98's ag count was ~12% over the provider's** (641k against 572k, build 75):
  not explained yet. A guess to check: thinking blocks counted but no longer sent.

## One process per session, on macOS

ag lets one process at a time run a session (`_open`, store/operations.py's `claim`): a second one -- another
terminal, the dashboard's chat -- is refused while the first runs, and the dashboard's chat agent, idle between
turns, gives way. A process is told by its id and when it started ("<boot id>:<start ticks>"), so a crashed
session's id, reused by another process later, does not hold the session forever. Both come from /proc
(store/processes.py's `identity`), which only Linux has.

- [ ] **On macOS no session is ever claimed, for either harness.** `identity` gives nothing there, so the claim
  answers `{"claimed": null}` and records nothing. Two processes can run the same session at once, each sending
  its own history; and `_reads.pid` stays empty, so the dashboard can't tell from it whether a session's process
  still runs.
  - **Claude Code:** the launcher claims a session it knows (`--resume <id>`, `--session-id`), and the hook claims
    at every call, by the process at the other end of the call's connection (hook_server/peer.py, which reads
    /proc/net/tcp). On macOS neither runs: the launcher's process can't be told, and the hook skips the claim
    when it has no process.
  - **Codex:** the launcher claims a thread resumed by its id (`resume <id>`). A new thread's id is codex's to
    choose, known only at its first call, and codex's hook does not claim at calls -- so a new thread is not
    claimed on Linux either, and `resume --last` or the picker neither.
  - **What it needs:** a process's start time on macOS (`sysctl` KERN_PROC_PID's `p_starttime`, through ctypes;
    or `ps -o lstart= -p <pid>`, to the second), with the boot time (`sysctl kern.boottime`) in place of the boot
    id. The caller's process then comes from the run in the URL, not the connection: codex's launcher already
    puts its process's id there (`/r/<run>/`, `request.run`) -- ag runs the harness in its own process, so the
    run is the harness's -- and Claude Code's launcher could do the same in ANTHROPIC_BASE_URL. Codex's hook
    could then claim at its thread's turns, as Claude Code's does, which covers new threads too.

## Codex

Checked live on codex 0.164 (gpt-5.6-luna, a ChatGPT login): a new session in the Terminal view, the message box
(closed, and into an open terminal), tool calls, `/compact` and a follow-up, a subagent, a second session reading
the first's history through the gatherer, stopping a turn, and `ag codex exec` from the command line.

Not covered yet:

- [x] **Files and file notices in code mode.** Codex's default tool is `exec`, a script that calls
  `tools.apply_patch(...)` and `tools.exec_command({cmd: ...})`. Its calls are now read out of it
  (commands.opened_script) where the script writes their arguments out, each checked as itself would be; the
  Chat view titles the call by them.
- [ ] **A script's calls it does not write out** (`tools.exec_command({cmd})`, `"cat " + name`, a loop) are not
  read: the files they touch show only as changes seen on disk while the call ran, not as the call's reads.
- [ ] **The output of each of several calls in one script** is not known: what the script printed is shown under
  the last, and the others are checked for what they changed, not for what they read.
- [ ] **A new codex thread is not claimed**, and on macOS none is: see "One process per session, on macOS".
- [x] **macOS: a new codex terminal was never renamed to its thread**, so it showed twice: the dashboard's id with
  nothing, the thread with its messages. The dashboard found a terminal's thread by the process that made its
  calls (`_reads.pid`, from /proc). Each read now keeps its run too (`_reads.run`, the process ag started for the
  terminal), which the dashboard matches on any system.
- [x] **Codex's recap and title.** `/recap` (`thread_source=system`) and the thread's title (`thread_title`) run in
  threads of their own that name no other; codex's launcher now puts its run (its process id) in the URL
  (`/r/<run>/`), and the hook keeps each answer for the thread whose own turn that run sent last: the recap in
  `_recaps`, the title in `_names` (by "codex"), shown over the actor's last message.
- [ ] **A message-box codex session has no name.** `codex exec` never asks for a title; it needs ag's own naming.
- [ ] **Codex's automatic recap** (its `auto_recap` setting) should be kept the same way as `/recap`: not seen live.
- [x] **Codex's warning** "Running without the shared background server", shown when that server runs: ag's `-c`
  overrides need codex embedded, so ag now runs it with `--no-daemon` (where its version has it), which says so.
- [x] **Codex's counts are the provider's** (codex/ag_orchestrator/counting.py), as Claude Code's are: each call's
  new steps counted by OpenAI's /v1/responses/input_tokens after it is sent, its reasoning by what the call's own
  count is over that, and the call counted before it is sent near the budget. Without the endpoint, by differencing
  the calls' own counts.
- [ ] **Remind the user to set an OpenAI API key.** Under a ChatGPT login, codex's own endpoint (the ChatGPT backend)
  has no count; the hook counts with OPENAI_API_KEY, if the hook server has it. Without it, counts come from
  differencing the calls' own counts: each call's total is exact, but a reasoning item's cost is carried by the items
  beside it, and there is no exact count before a call is sent. The dashboard or `ag codex` should say so, and how
  to set one.
- [ ] **`memory_consolidation`** side calls are passed through on the strength of the codex binary's strings
  alone: not seen live.
- [ ] **Reasoning across turns, by OpenAI's count.** Live (gpt-6-luna at high effort, three turns), the first
  reasoning item came to 75 tokens against the 73 its answer reported, but the second to 13 against 84. Check
  whether OpenAI counts an earlier turn's reasoning in full when it is sent back, or one answer's reasoning is
  more than the items ag sees.
- [ ] **A build under codex, live.** Not yet watched: with a low `max_context_tokens` on a test gatherer, check that
  builds start before codex's own compaction point (its stated limit, 90% of the window) and codex never compacts
  by itself.
- [x] **Codex's subagents and background terminals** are background work, as Claude Code's background agents and
  commands are: from its rollout (`SubAgentActivity` started/ended; a command's output naming its session, until
  its `CommandExecution` completes). /review's reviewer and the `subagent` side calls are still only passed through.
- [x] **Codex's subagents' reports** are notes, as Claude Code's are: its `agent_message` items (another of its agents'
  message) are context, not the model's (codex adaptor), and the Chat view shows a FINAL_ANSWER as "Subagent's report:
  <its task>" under the turn that started it -- read from the subagent's own record while codex has not handed it
  back yet, which waits for the thread's next call (files.py, the `report` on its `task_ended`). What a subagent was asked is
  encrypted in `spawn_agent`'s call, so it is named by its task name.
- [ ] **The approval reviewer** (`guardian_review`, for `--approve-for-me`, which the dashboard always uses) is passed
  through; its verdict could say why codex did not run something.
- [ ] **Codex tries a WebSocket first.** The hook server answers 426, and codex logs "failed to connect to
  websocket: HTTP error: 426 Upgrade Required" on every run before falling back to HTTP. Harmless, but noise in
  `codex exec`'s output; codex could be told not to try.
- [ ] **A codex patch's command** reads "apply_patch" in the Files view's commands, not the file it changes.
- [x] **Tests that fail on macOS by path alone:** test_dashboard_codex's ExecTest, test_join's guide test and
  test_pi_launch compare paths as written, not through the /var symlink (#128).

## The Editor panel

The Editor (editor.py, page.html's "the Editor") opens from a pane's header above the panes: the actors' views are
below it, shorter while it is open, and Cmd/Ctrl+click in the list opens more of them side by side. On its left, a
folder's tree, any folder: the one above, one typed, or an actor's working directory. A file opens as a shared document
(Yjs, kept by pycrdt on the dashboard's side): every page with the file open sees the others' edits and cursors as they
type. A change written to the file (by an actor, or anything else) is merged three ways, by line, as version control
merges: lines only the file changed take its change (marked until the next change on disk, or the header's ×). The
lines edited in the Editor since the file was opened are its conflict zone, lightly tinted, saved or not: the file's
change to them is a conflict -- the pages' lines kept, the file's shown under them ("On disk now"), with Restore yours /
Accept its rewrite / Keep both -- however it came to change them (an actor rewriting what was typed and auto-saved, a
script's write from the file before the save, the save undone on purpose). The zone stays until "Clear" in the header,
or until no page has the file open (ZONE_GRACE seconds after the last goes). Save writes the document to the file;
with Auto-save on (a switch in its header, on by default; turned off, kept so in the browser), so does a pause of a second after any
edit to it -- except of a file deleted on disk, which only Save writes again.
Each listed file and folder has the actors that changed it in the last half hour, from what ag's hook found their tool
calls did on disk (`_touches`): two or more are an amber badge in the tree, and "N actors changing it" over the file.

Not done yet:

- **Who changed it comes a moment late.** ag records a call's changes when its results come back, a few seconds after
  the file changed: until then the change is credited to the one actor running in a directory that holds the file,
  if there is just one (said as "likely").
- **The actors are not told.** A save from the Editor changes a file an actor may be working on; Claude Code's Edit
  and Write then refuse ("modified since read") and re-read it, but nothing says who changed it or why. Once the
  dashboard writes its own actions as events, a save should be one (the user's edit of the file), for the gatherer
  to pass on. Nor are two actors told they are changing the same file: the Editor shows it, but only to the reader.
- **The zone is the file's, not each reader's.** Every page's edits go in one zone, and it is cleared for all by
  "Clear", or only once the last page closes the file. A page's stream that breaks for longer than ZONE_GRACE loses
  it. An actor asked to rewrite what the reader just wrote is asked about too (Accept its rewrite).
- **Nothing stops the write.** The zone guards the Editor's copy, not the file: the actor's change is on disk before
  it is shown, and the actor is not told. A Claude Code hook refusing Edit/Write on zone lines would stop it first.
- **A save's race.** A save made in the moment between its own look at the file and its write can still overwrite a
  write (`Room._write` looks again just before it replaces the file, which narrows the window, not closes it).
- **Conflicts are by line.** Two edits on the same line are a conflict even where they touch different words; edits
  on lines side by side merge. An edit a page sends while the disk's change is being merged (in flight, ~50 ms) is
  merged by the CRDT, not checked. A conflict's lines are kept in the dashboard's memory: a restart drops them (and
  the unsaved lines with them).
- **No "revert to the file".** A page cannot throw away the unsaved changes and take the file as it is, but by
  clearing the zone and putting the file back.
- **Unsaved edits live in the dashboard's memory.** A dashboard restart loses them: the page says so and opens the
  file again from disk. They could be kept in the dashboard's own table (the document's update, per file).
- **One file at a time.** The tree opens one file, with no tabs.
- **Large pastes.** A single edit over the server's 1 MB request limit (MAX_BODY) is refused; the page should split
  it, or the edit endpoint take more.
- **Codex.** Nothing in the panel is Claude Code's, but it has only been tried with Claude Code actors.

## Actors on branches of their own

An actor started from a gatherer's "+ more" drop-down, "Actor on a branch…" (branches.py) works in a worktree of one of the gatherer's projects,
`<project>-worktrees/ag-<id>` on branch `ag/<id>`, from the project's last commit; what it changes there is merged into
the project's folder as it changes it -- all of it, but the conflict zone's lines and those the project changed too,
which wait in the Editor; with "auto-merge with approval", every change waits. Its lines are tinted in its hue until it
is closed.

- **The project's uncommitted work is not on the branch.** The worktree starts from the project's last commit, so the
  actor does not see what was not committed (the merge into the project keeps it). Copying it over would put it in the
  actor's commits.
- **The same change, twice.** Once the actor's branch is merged on GitHub, pulling it into the project finds the same
  lines already there, uncommitted: git refuses the pull until they are committed or put away.
- **Not text, not merged.** A file that is not UTF-8 text, or is over the Editor's MAX_BYTES, is left out silently;
  the branch card could list it.
- **Renames.** A file the actor moves is a file deleted and a file made, each asked about (with approval) or merged.
- **A held change after a restart.** What waits is worked out again from the branch's files at the dashboard's first
  look; a place held because of the zone stays held (kept in `branch_files.held`), though the zone itself is gone.
- **One Editor, the project's.** The Editor opened from such an actor shows its project; its own worktree is one more
  folder to pick.
- **The branch is the actor's.** Nothing removes a worktree or branch once its actor has worked in it (one never used
  goes with its session); nor is a pull request opened for it.
- **The note needs ag's policy.** An actor is told its change was left out through ag's stream messages
  (`context_stream`), which the proactive_context_manager policy shows at its next model call; a gatherer on another
  policy may not show them. Nothing else of the project's reaches the actor: it is not told of the reader's own edits.
- **Codex.** Branches work for Codex sessions too (its thread's id is followed through `started_as`), but have only
  been tried live with Claude Code.

## DocWriter

DocWriter (github.com/docwriter-org/docwriter, MIT; docwriter.py, assets/src/docwriter) is an actor of its own: a
gatherer's "+ more" drop-down, "DocWriter…" (its box asking the folder and Claude Code or Codex), starts one in the folder a new
session there would use by default, and selecting it shows DocWriter's page as its view, filling the pane (its Terminal, Chat and History one
click away; no message box: DocWriter has its own). Its page is built from a pinned copy of DocWriter's source, the parts
that talked to its server swapped for ones that talk to the dashboard. Its actor is started with DocWriter's system
prompt and its six document tools (an MCP server of the dashboard's, whose calls a DocWriter page runs on its
own copy of the document, with DocWriter's code). A request in DocWriter -- a chat message, feedback on a passage, a
reply on a thread, an accepted edit -- is DocWriter's per-turn prompt sent to the actor as a message, and its turn is
followed in the gatherer and shown in DocWriter's history. What the reader decides (a proposal accepted, rejected,
dismissed; a comment; a reply; the agent's settings) is an event of the dashboard's in the actor's channel.
LaTeX: files open as source, the PDF beside them (pdf.js's viewer), SyncTeX both ways, and DocWriter's hooks (its
pdflatex template) run in the folder at the end of each turn.

Not done yet:

- **The tools need a page open.** The actor's edit_doc and the rest run in a DocWriter page; with none open, a call
  says so and the actor stops. Running them on the dashboard would need DocWriter's proposals code in Python, kept in
  step with upstream's (and pycrdt's byte positions).
- **Codex is only told.** Claude Code's own Edit/Write on a file open in DocWriter is refused by a PreToolUse hook
  (docwriter_guard.py), pointing it to edit_doc. Codex has no such hook: its instructions say to use the tools, and a
  direct write is folded in as a change from outside (seen, not offered to accept or reject). A read-only sandbox
  would stop it, but also its own scratch files.
- **Not sent, or not offered.** Images in a message (only its words are typed), a plan-first turn's ExitPlanMode
  (the plan comes as the actor's last words, shown as DocWriter's plan card), the retry round upstream runs when a
  feedback turn proposed nothing, the agent's cost. Hidden from DocWriter's page: the model picker (the actor's own),
  style references and calibration, Word comments import, its own agent sessions, API keys, skills.
- **Its prompt in the actor's Chat.** The actor's Chat shows each message whole: DocWriter's <workspace_state> and the
  rest before the author's words. Chat could show the <user_message> alone for a DocWriter actor.
- **Turns are followed, not streamed.** DocWriter shows the actor's words and tool calls as ag stores them (per message
  and per call), not as they are written; a turn's end is the actor's status (turn over, idle).
- **Wake-ups are off.** DocWriter wakes its agent after each pause in typing; here each would be a message in the
  actor's Chat and Terminal, so only `[dashboard] docwriter_wake = true` in config.toml turns them on.
- **The folder-trust question.** A new folder's first message opens Claude Code's (or codex's) terminal, which asks
  whether to trust it before anything is sent; DocWriter says, after 20 s with no word from the actor, to look there.
- **The bundle is 8.5 MB** in ag_dashboard/vendor/docwriter/: DocWriter's page 2.2 MB, pdf.js's viewer 6.3 MB.

## Browser

A Browser (browser.py) is an actor of its own, like DocWriter's: a gatherer's "+ more" drop-down, "Browser…" (Claude
Code or Codex), starts one in the folder a new session there would use, and selecting it shows its view -- a Chrome tab
the user and the agent use together (its Terminal, Chat and History one click away, the message box under it). One
Chrome serves every Browser: by default the dashboard's own, headless, over a pipe (no port), its profile the home's;
with `[dashboard] browser_profile = "mine"`, the user's own Chrome (their logins and history), its remote debugging
turned on at chrome://inspect/#remote-debugging, over a WebSocket once they click Allow, each tab hidden from their
tab strip. Its tabs are each Browser's own.
The user's mouse, wheel and keys go to the tab as Chrome's own input, the screen comes back as Chrome's screencast;
Pick and Area point the agent at an element or a box, each a chip going with the next message (`<browser_state>`,
with the page and what the user did since) and a ref the agent's tools take. The agent's 18 tools (snapshot, click,
type, ...) are an MCP server of the dashboard's, run on the tab with or without a page open; what it does now is
outlined on the user's screen.

Not done yet:

- **The gatherer agent cannot start one.** `ag actors new --docwriter` exists; a `--browser` would go the same way
  (coordination.py's `new`).
- **Frames inside frames.** A snapshot is the main frame's accessibility tree; an iframe from another site (a payment
  widget, a video) shows as one element, and Pick picks the iframe. Its own tree is a `frameId` away.
- **What the screen lacks.** The pointer's shape (a hand over a link), typing composed by an input method (Chinese,
  Japanese), dropping a file onto the page, the user's own file chooser (the agent's `upload` tool sets a file input),
  the page's own context menu, sound.
- **Frames as JPEG over server-sent events.** Fine on this machine; through an SSH tunnel each frame is 30-150 KB.
  Binary frames (a WebSocket) or a lower quality while scrolling would cut it.
- **One dashboard per home.** Chrome locks its profile: a second dashboard on the same home cannot start its own.
- **The user's Chrome ("mine").** Tried against a stand-in (a Chrome with `--remote-debugging-port`, which asks
  nothing), not yet the user's own with its Allow dialog. Each new connection asks again: one is kept, but a dashboard
  restart, or Chrome quitting, means one more Allow. Its tabs are hidden ones, closed with the dashboard; a window the
  page opens (a login popup) shows in the user's Chrome as a tab of its own. The agent can act on every site the user
  is logged into.
- **Downloads** go to <home>/dashboard/downloads, the agent told so; the page only notes that one finished.
- **Linux** is untested: it needs google-chrome or chromium on the PATH (headless: no display), or
  `[dashboard] browser` in config.toml.
