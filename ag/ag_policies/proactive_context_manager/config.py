"""Every parameter of the proactive context manager, with its default: when it builds,
the budgets of its sections, the models the tools call, and how a stream
message, a request made in another channel and an environment update are shown
(`message`, `parallel_message`, `notice`), and the guide that opens every
context (`gatherer_guide`). The models default to the LLM's own
(`llm.model`, see tools/options.py).

The tools declare what they are told as their own `Params`
(`tools/segmentation.Params`, ...); the properties at the end build those
from the flat fields here, so one config states everything and the tools
know nothing of it.
"""

from dataclasses import dataclass, field, replace
from typing import List, Tuple

from ..tools import boundary as boundary_tool
from ..tools import ranking as ranking_tool
from ..tools import segmentation as segmentation_tool
from ..tools import summarize as summarize_tool
from ..tools.groups import Groups

# Every file-change notice ends with this: a notice that arrives while the agent works on something
# the change does not touch is otherwise treated as settled by its next answer, and forgotten when a
# later question does depend on the file.
REMEMBER_ONE = (' Remember this for later too: until you have read the file again, any answer or work, in this turn or a later one, that uses its contents must start by re-reading it.')
REMEMBER_MANY = (' Remember this for later too: until you have read them again, any answer or work, in this turn or a later one, that uses their contents must start by re-reading them.')


@dataclass
class ProactiveContextManagerConfig:
    # All the model gets with a call -- the sections, the pinned rows and the running task
    # (its verbatim events since the cut, with the notices, stream messages and other
    # channels' requests among them), the history's preamble, the sections' overview, and
    # what the harness sends besides the context (its system prompt and tools) -- is at most
    # max_context_tokens: above it, on any read, a build is started, waited for, and cuts
    # the running task so the context is below it again. At a user message, X being that size:
    #     X <  min_context_tokens   no build
    #     min <= X                  ask the model whether this message starts a new
    #                               task (tools/boundary.py); build if so
    # A build whose context would still be over the limit cuts the running task after its
    # last event: all of it so far becomes "This task so far" (keep_so_far_tokens), and
    # only what comes after is verbatim. What the budgets (below) leave under the limit
    # is the headroom the running task grows into before the next build:
    # their sum + keep_pinned_tokens < max_context_tokens.
    #
    # A harness that states its own limit with a call (where it compacts by itself, or
    # where its model's window ends: the `limit` of a read) sets max_context_tokens for that
    # call's channel to harness_limit_fraction of it, unless the gatherer's options set
    # max_context_tokens; below the default, the budgets and min_context_tokens shrink with
    # it in proportion (`within_limit`). The fraction leaves room for one step's growth: the
    # harness checks its limit right after an answer, before ag's next read can act.
    min_context_tokens: int = 15000
    max_context_tokens: int = 200000
    harness_limit_fraction: float = 0.9
    keep_pinned_tokens: int = 5000        # the pinned rows of the condensed span (the newest kept)
    build_every_request: bool = False     # build at every user message (tests, experiments)
    sync_seconds: float = 15.0            # how long a read waits for the worker it started
                                          # (over the limit: up to build_timeout)
    build_wait_seconds: float = 45.0      # once the check finds a new task, how long the read waits for
                                          # that build, from when it began waiting (such builds took
                                          # 15-28 s); one still running is taken up at a later call
                                          # of the same turn
    check_boundaries: bool = True         # at or over min_context_tokens, ask; False = no build there
    boundary_cooldown: int = 2            # user messages into the open task before asking
    boundary_tasks_shown: int = 2         # finished tasks shown to the check, for contrast
    boundary_block_chars: int = 6000      # per task block in the check's prompt
    build_timeout: int = 3600             # a running build older than this is dead
    require_smaller: bool = True          # refuse to adopt a build whose sections are not
                                          # smaller than the history they replace

    # Segmentation.
    task_chunk_tokens: int = 6000         # no task larger (user+agent message tokens)
    max_subdivide_depth: int = 3
    chunk_window_tokens: int = 30000      # rendered turns per segmentation call
    chunk_prior_tasks: int = 20           # earlier tasks shown to each call (0 = all)
    summarize: bool = True                # record what each task established
    summarize_workers: int = 0            # 0 = one thread per task

    # Budgets, in tokens.
    keep_previous_task_tokens: int = 15000
    keep_temporal_relevant_tokens: int = 15000
    keep_task_relevant_tokens: int = 15000
    all_task_tokens: int = 30000          # this channel's earlier requests
    parallel_index_tokens: int = 10000    # other channels' requests in the index
    keep_so_far_tokens: int = 15000       # the running task, condensed, when a build cuts it ("so far")

    # Ranking.
    parallel_related_tasks: bool = True   # other channels' tasks may be ranked in
    rank_turns: int = 3                   # last turns that say what the work is now
    rank_top_n: int = 0                   # 0 = the tool sizes it from the budget when not told
    rank_legroom: int = 40                # % more candidates than fit
    task_tokens_fallback: int = 700

    # Models.
    segment_model: str = ""
    segment_effort: str = "high"
    segment_timeout: int = 900
    summarize_model: str = ""            # "" = segment_model; summaries (and cleaned requests) are written by it
    summarize_effort: str = ""           # "" = segment_effort
    rank_model: str = ""
    rank_effort: str = "low"
    rank_timeout: int = 180
    boundary_model: str = ""
    boundary_effort: str = "low"
    boundary_timeout: int = 60

    # Events: how the policy groups the event types it works from (tools/groups.py).
    groups: Groups = field(default_factory=Groups)

    # Tell the agent where its full history is (in the gatherer guide, below).
    db_hint: bool = True

    # The gatherer guide: the first item of every context, after the harness's own set-up, on
    # every read -- with or without a build -- so the agent knows from its first call what the
    # gatherer adds to its context and where the rest is. `{db_path}` is the context database. With
    # db_hint, the database's layout follows it (layout.DB_HINT). "" = no guide.
    gatherer_guide: str = (
        "About this context, from the gatherer.\n\n"
        "This session runs inside a gatherer: it puts your context together on every call, and "
        "other sessions may be working in the same gatherer, in parallel or before you, for the same "
        "user. Besides the conversation itself, your context may hold these messages from the "
        "gatherer:\n\n"
        "- **History sections**: earlier history, of this session or of the gatherer's other "
        "sessions, put together to fit. The first of them says how they are organised and how to "
        "read them.\n"
        "- **Requests made in parallel** (\"The user sent this to another session working in parallel "
        "with you: ...\"): a request the user made to another session, where it arrived -- before "
        "your user message, or after your latest step if it came mid-turn. It is not your task, but "
        "the same user gave it, on the same material: a definition, convention, correction or "
        "exclusion stated there applies to your work too.\n"
        "- **File-change notices**: a file you read has been modified by someone else since. What "
        "you read from it is out of date; read it again before relying on it.\n"
        "- **Messages from a stream** (\"Message in <stream> from <author> ...\"): information "
        "from outside the conversation, at the point it arrived.\n"
        "- **Left-out notes** (\"[Agent steps were left out here ...]\"): steps of this session "
        "dropped to keep the context within its limit; they name the rows to read them from.\n\n"
        "None of these is the user speaking to you in this session: the user's own messages are the "
        "requests you answer.\n\n"
        "**Other actors, and the gatherer agent.** The other sessions of this gatherer are actors like you -- "
        "Claude Code, Codex and other agents -- often working in the same directories at the same time. Each is "
        "known by its session id (the one a request made in parallel names), or its first characters. Run "
        "`ag actors` in your shell to list them -- their ids, names, status, directories and what each was last "
        "asked -- and `ag actors --help` for the rest: what one is doing (`show`), which actors changed a file "
        "(`who`), and `ag actors send <id> \"<message>\"` to message one. A message from another actor reaches you "
        "as a message of this conversation starting \"Message from actor <id>\"; answer it the same way. "
        "`ag actors` talks to the dashboard on this machine. Under Codex, run every `ag actors` command with "
        "sandbox_permissions \"require_escalated\" from the first try: Codex's sandbox has no network, even to this "
        "machine, so it always fails inside it.\n\n"
        "The gatherer agent coordinates the actors for the user. If you find work conflicting with yours -- another "
        "actor changing files you are working on (a file-change notice for one of them; `ag actors who <file>` "
        "names who), or working on the same task or one that overlaps it -- don't settle it with the other actor "
        "yourself, and don't undo its changes: stop changing what the conflict touches, tell the gatherer agent with "
        "`ag actors send gatherer \"<the conflict, the other actor's id, and how you found it>\"`, and end your turn "
        "saying so. Its answer comes as a new message. A message starting \"Message from the gatherer agent\" is "
        "from it: it acts for the user, so listen to it and do as it says, as you would the user's own request -- "
        "unless the user tells you otherwise. Message it back only when it asks you to, or when you can't do what "
        "it says: each message costs it a turn.\n\n"
        "**The Editor's preview.** The dashboard's Editor has an Execute button that runs a git project's preview "
        "command and shows what it makes beside the file: a file it writes, the page of a server it starts, or its "
        "output. When the user asks for a preview, set it with `ag preview set \"<command>\" --show <file or URL>` "
        "(for the repository you are in); `ag preview` says what it is now, and `ag preview run` runs it, once the user "
        "has let that command run (`ag preview --help`). Under Codex, run it escalated too, as `ag actors`.")

    # The developer message a stream message (a `context_stream` event in the
    # verbatim part) is shown as, at its place in the history.
    # `{stream}`, `{author}` and `{text}` are the event's; `{timestamp}` is
    # the event's, shown as a UTC date and time when it is seconds since the
    # epoch.
    message: str = "Message in {stream} from {author} at {timestamp}: {text}"

    # The developer message shown, at its place in the history, for the
    # environment updates one poll found (`environment_update` events in the
    # verbatim part) whose subjects the verbatim rows before them refer to:
    # one message per poll. For one update, `notice`: `{what}` and
    # `{subject}` are the event's, `{timestamp}` as above. For up to
    # `notice_names` of them, `notice_named`, `{subjects}` naming each; for
    # more, `notice_counted`, with their `{count}`.
    notice: str = ("{what} at {timestamp}, after you last read it.{repeat} What you read from it before is now "
                   "out of date. Before giving any answer, or writing anything, that relies on its contents, read the "
                   "file again." + REMEMBER_ONE)
    # {repeat} in `notice`: added when the agent was already notified of an earlier change to the same file,
    # so a second change is not taken for the first one, already handled.
    notice_repeat: str = (" This is a new change that just happened, separate from any earlier notice you received "
                          "about this file: even a read you made after that notice may not include it.")
    notice_named: str = ("These files in your working directory were changed on disk after you last read them: "
                         "{subjects}. What you read from them before is now out of date. Before giving any answer, "
                         "or writing anything, that relies on their contents, read them again." + REMEMBER_MANY)
    notice_counted: str = ("{count} files in your working directory were changed on disk after you last read them. "
                           "What you read from them before is now out of date. Before giving any answer, or writing "
                           "anything, that relies on one of them, read it again." + REMEMBER_MANY)
    notice_names: int = 5

    # The developer message each request the user made to another channel since
    # the build in use (all of them, before one) is shown as: right before the
    # user message the agent is working on, or, arriving mid-turn, after the
    # turn's latest step -- as Claude Code shows a message the user sends
    # mid-turn. Its text is the same wherever it goes: it stays there, and a
    # changed text would leave out the thinking after it. `{text}` is the
    # request; `{channel}` the other channel's id; `{db_path}` and
    # `{channel_column}` where its work can be read. With no build, those made
    # before the channel began are messages only while they fit within
    # all_task_tokens + parallel_index_tokens; past that, one block of the
    # newest that fit (policy.requests_before).
    parallel_message: str = (
        "The user sent this to another session working in parallel with you:\n{text}\n\n"
        "This is how the gatherer shows you what the user asks its other sessions, where it arrived in "
        "your conversation. It is not addressed to you: do not answer it or take it up, and carry on with "
        "your own task. But a definition, convention, correction or exclusion the user states in it "
        "applies to your work too. That session's work is in {db_path}, table events, where "
        "{channel_column} = '{channel}'.")

    # A user message of another channel that opens a line, in its first characters, with one of these is not
    # shown to this one (policy.py's `shared`): a message the actors of the gatherer sent each other through the
    # dashboard (`ag actors`, ag_dashboard/coordination.py's envelopes), the receiver's to act on, not a request of the
    # user's. () = every one shown.
    unshared_openings: Tuple[str, ...] = ("Message from the gatherer agent", "Message from actor ",
                                          "Update (you asked with `ag actors when`")

    def __post_init__(self):
        held = self.section_budgets + self.keep_pinned_tokens
        if held >= self.max_context_tokens:
            raise ValueError(
                f"the budgets do not fit max_context_tokens={self.max_context_tokens}: sections "
                f"{self.section_budgets} + keep_pinned_tokens {self.keep_pinned_tokens} = {held}, which leaves "
                f"no headroom before the next build")
        if self.min_context_tokens >= self.max_context_tokens:
            raise ValueError(
                f"min_context_tokens={self.min_context_tokens} is not under max_context_tokens="
                f"{self.max_context_tokens}: the context never reaches it, so the policy would never check "
                f"whether a user message starts a new task")

    @property
    def section_budgets(self) -> int:
        """Every section's budget, added up: the most the sections can hold."""
        return (self.all_task_tokens + self.parallel_index_tokens + self.keep_temporal_relevant_tokens
                + self.keep_task_relevant_tokens + self.keep_previous_task_tokens
                + self.keep_so_far_tokens)

    # ---- what each tool is told, from the fields above

    @property
    def segmentation(self) -> segmentation_tool.Params:
        return segmentation_tool.Params(task_chunk_tokens=self.task_chunk_tokens, max_subdivide_depth=self.max_subdivide_depth,
                                   chunk_window_tokens=self.chunk_window_tokens, chunk_prior_tasks=self.chunk_prior_tasks,
                                   summarize=self.summarize, model=self.segment_model, effort=self.segment_effort,
                                   timeout=self.segment_timeout)

    @property
    def summarizing(self) -> summarize_tool.Params:
        return summarize_tool.Params(workers=self.summarize_workers, model=self.summarize_model or self.segment_model,
                                effort=self.summarize_effort or self.segment_effort, timeout=self.segment_timeout)

    @property
    def boundary(self) -> boundary_tool.Params:
        return boundary_tool.Params(tasks_shown=self.boundary_tasks_shown, block_chars=self.boundary_block_chars,
                               model=self.boundary_model, effort=self.boundary_effort, timeout=self.boundary_timeout)

    @property
    def ranking(self) -> ranking_tool.Params:
        return ranking_tool.Params(turns=self.rank_turns, top_n=self.rank_top_n, legroom=self.rank_legroom,
                              budget_tokens=self.keep_task_relevant_tokens, task_tokens_fallback=self.task_tokens_fallback,
                              model=self.rank_model, effort=self.rank_effort, timeout=self.rank_timeout)


#: What shrinks with max_context_tokens when a harness's limit puts it below the config's own.
SCALED = ("min_context_tokens", "keep_pinned_tokens", "all_task_tokens", "parallel_index_tokens",
          "keep_temporal_relevant_tokens", "keep_task_relevant_tokens", "keep_previous_task_tokens",
          "keep_so_far_tokens")


def within_limit(cfg: ProactiveContextManagerConfig, limit: int) -> ProactiveContextManagerConfig:
    """`cfg` for a harness whose own limit is `limit` tokens: max_context_tokens is
    harness_limit_fraction of it; when that is below cfg's, the budgets and
    min_context_tokens shrink in the same proportion, so they fit as they did.

    Raises:
        ValueError: the limit leaves too little to fit them.
    """
    target = int(limit * cfg.harness_limit_fraction)
    if target == cfg.max_context_tokens:
        return cfg
    if target > cfg.max_context_tokens:
        return replace(cfg, max_context_tokens=target)
    factor = target / cfg.max_context_tokens
    return replace(cfg, max_context_tokens=target, **{f: int(getattr(cfg, f) * factor) for f in SCALED})
