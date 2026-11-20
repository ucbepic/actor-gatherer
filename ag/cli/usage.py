"""ag's options and commands, as data: `ag --help` lists them, the parser accepts exactly
these options (tests/test_cli.py holds it to that), and the docs' tables are made from
them (docs_build/hooks.py)."""

#: (option, what it does), in the order `ag --help` and the docs list them.
OPTIONS = (
    ("--group NAME", "Join the named group (a gatherer), created if it does not exist. Overrides `[cli] gatherer`. "
                     "--gatherer NAME is the same."),
    ("--gatherer .", "Give each session a new gatherer of its own, named after the session."),
    ("--policy P", "Create the gatherer with policy `P`. Refused if it exists with another policy."),
    ("--poller X", "Create the gatherer with poller `X` (repeatable)."),
    ("--no-pollers", "Create the gatherer with no pollers."),
    ("--channel ID", "Keep the session in channel `ID` of the gatherer, for a harness that picks its session's id only "
                     "at its first call (codex, agy): the session is known by `ID` from its start."),
    ("--dry-run", "Print the command and environment that would run, and run nothing."),
    ("--quiet", "Start the harness without ag's notes on what it set up. Problems still print."),
    ("-h, --help", "Show this help."),
)

#: (command, what it does).
COMMANDS = (
    ("ag", "Start the agentic development environment on localhost and open it in the browser."),
    ("ag <harness> [args]", "Run the harness with the Gatherer."),
    ("ag model [NAME] [--api-base URL] [--key-env VAR]", "Show or set the LLM the Gatherer calls."),
    ("ag config", "Show where the settings are, and what each harness resolves to."),
    ("ag status / ag stop [--force]", "List / stop the proxies `ag` started (not the dashboard). Sessions that call "
                                     "through them have their calls refused until `ag` starts a harness again, so "
                                     "from an actor's shell `ag stop` leaves its own alone unless --force."),
    ("ag dashboard [--port N] [--no-open] [--out FILE]", "The same, on another port, without opening the browser, or written to one file."),
    ("ag dashboard restart", "Stop the home's dashboard and start it again, on the code now on disk; the terminals "
                             "it runs close (`ag dashboard restart --help`)."),
    ("ag actors [show|who|send|new|when ...]", "From an actor's shell: the other actors of its gatherer, a message to one "
                                               "or to the gatherer agent (`ag actors --help`)."),
    ("ag preview [set|run|clear ...]", "The preview of a git project, which the LaTeX editor's Execute button runs "
                                       "and shows beside the file (`ag preview --help`)."),
    ("ag apps [list|help|mine|call ...]", "The apps: every one installed, an app's instructions and tools, the instances "
                                          "this actor may use, and a call of one (`ag apps --help`)."),
    ("ag tasks [path]", "From an actor's shell: the dashboard's folders, tasks, actors and apps, walked like a "
                        "directory."),
    ("ag groups [show|folder|actor|merge|rename ...]", "The home's groups, who shares context with whom, and changes "
                                                        "to them, each said first (`ag groups --help`)."),
    ("ag gatherers", "List every gatherer: its policy, pollers, events and last activity."),
    ("ag show <gatherer>", "Show a gatherer's resolved settings."),
    ("ag new <gatherer> [--policy P] [--poller X ... | --no-pollers]", "Create a gatherer ahead of use."),
    ("ag home list", "List every available policy and poller, and any problem."),
    ("ag home path", "Print the home directory."),
)


def _columns(rows, width: int = 22) -> str:
    """Two columns; an entry wider than `width` puts its description on the next line."""
    out = []
    for a, b in rows:
        b = b.replace("`", "")
        out.append(f"  {a.ljust(width)}{b}" if len(a) < width else f"  {a}\n  {'':{width}}{b}")
    return "\n".join(out)


def help_text(intro: str) -> str:
    """`ag --help`: the package's docstring, then the options and the commands."""
    return f"{intro.strip()}\n\nOptions (before the harness's name):\n{_columns(OPTIONS)}\n\nCommands:\n{_columns(COMMANDS)}"
