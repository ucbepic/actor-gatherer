"""ag's options and commands, as data: `ag --help` lists them, the parser accepts exactly
these options (tests/test_cli.py holds it to that), and the docs' tables are made from
them (docs_build/hooks.py)."""

#: (option, what it does), in the order `ag --help` and the docs list them.
OPTIONS = (
    ("--gatherer NAME", "Join the named gatherer, created if it does not exist. Overrides `[cli] gatherer`."),
    ("--gatherer .", "Give each session a new gatherer of its own, named after the session."),
    ("--policy P", "Create the gatherer with policy `P`. Refused if it exists with another policy."),
    ("--poller X", "Create the gatherer with poller `X` (repeatable)."),
    ("--no-pollers", "Create the gatherer with no pollers."),
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
    ("ag status / ag stop", "List / stop the proxies `ag` started."),
    ("ag dashboard [--port N] [--no-open] [--out FILE]", "The same, on another port, without opening the browser, or written to one file."),
    ("ag actors [show|who|send|new|when ...]", "From an actor's shell: the other actors of its gatherer, a message to one "
                                               "or to the gatherer agent (`ag actors --help`)."),
    ("ag preview [set|run|clear ...]", "The preview of a git project, which the dashboard Editor's Execute button runs "
                                       "and shows beside the file (`ag preview --help`)."),
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
