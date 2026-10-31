<div align="center">

# The Actor-Gatherer Framework for AI Agents

[![Blog](https://img.shields.io/badge/Blog-read%20more-purple)](https://ucbepic.github.io/actor-gatherer/)
[![Docs](https://img.shields.io/badge/Docs-actor--gatherer%2Fdocs-green)](https://ucbepic.github.io/actor-gatherer/docs.html)
[![Works with Claude Code, Codex, OpenCode and Pi](https://raw.githubusercontent.com/ucbepic/actor-gatherer/main/assets/works-with.svg)](#quickstart)

[What is the Actor-Gatherer Framework](#what-is-the-actor-gatherer-framework) · [Install](#install) · [Quickstart](#quickstart) · [Agentic Development Environment](#agentic-development-environment) · [Examples](#examples) · [How it works](#how-it-works) · [Extensions](#extensions)

</div>

---

## What is the Actor-Gatherer Framework

Actor-Gatherer is a new paradigm in agent design where the context across agents is managed proactively and externally, separating solving a task from context management needed to do so.
An **Actor** (your coding agent: Claude Code, Codex, OpenCode or Pi) works on
the task. A **Gatherer** (also AI-powered) monitors the Actor, other agents and the environment,
and before every model call decides what context the Actor gets. The Gatherer:

- **Shares information across agents:** Actors using the same Gatherer can benefit from each other’s work, even when they run on different harnesses,
- **Keeps context relevant:** It identifies what's relevant for the current task from past interactions, paging in useful information and removing redundant details, and
- **Tracks the environment:** If a file the Actor relies on changes, the Gatherer surfaces the update before the Actor acts on outdated information.

Without a Gatherer, each agent operates largely on its own history, which is typically summarized as it grows. This can leave agents unaware of relevant past interactions, work done by other agents, or changes made by the user.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ucbepic/actor-gatherer/main/assets/dashboard-dark.png">
    <img src="https://raw.githubusercontent.com/ucbepic/actor-gatherer/main/assets/dashboard-light.png" alt="ag's agentic development environment: on the left, the Actors by gatherer; at the bottom, a Claude Code Actor and a Codex Actor working side by side, each adding a function to catalogue.py; above them, the Editor showing catalogue.py as they change it, with the newest change highlighted" width="900">
  </picture>
</p>
<p align="center"><em>The <a href="#agentic-development-environment">agentic development environment</a>. Claude Code and Codex work side by side, each adding a function to <code>catalogue.py</code>, and the Editor above them shows the file as they change it.</em></p>

---

## Install

You need Python 3.11+ and the harness you want to run on your `PATH`. Install `ag` from PyPI:

```bash
pip install actor-gatherer
```

Or from source:

```bash
git clone https://github.com/ucbepic/actor-gatherer && cd actor-gatherer
pip install -r requirements.txt        # `ag` from this clone, editable, with every dependency
```

### Set the Gatherer's LLM

The Gatherer uses LLMs to manage the context of Actors, so you must set the model the
Gatherer uses. It can be an API-based model, called through
[LiteLLM](https://docs.litellm.ai/docs/providers). Name it as `provider/model`, and set that provider's API key, e.g.,

```bash
ag model openai/gpt-6-sol                    # "provider/model"; the key from OPENAI_API_KEY
export OPENAI_API_KEY=...

ag model gemini/gemini-3.8-flash             # or a Gemini model; the key from GEMINI_API_KEY
export GEMINI_API_KEY=...
```

Or it can be a coding agent, such as Claude Code or Codex, named as

```bash
ag model claude-code/sonnet
ag model codex/gpt-6-sol
```

which runs Claude Code or Codex for the Gatherer. To use Codex, make sure OpenAI's Codex SDK is installed:

```bash
pip install openai-codex
```

To check the model that is set:

```bash
ag model
```

## Quickstart

Put `ag --gatherer NAME` in front of the agent command you would normally run.

```bash
ag --gatherer demo claude                                # Claude Code
ag --gatherer demo codex exec "fix the tests"            # Codex
ag --gatherer demo opencode run "add a --verbose flag"   # OpenCode
ag --gatherer demo pi                                    # Pi
ag --gatherer demo antigravity                           # Antigravity (agy; needs GEMINI_API_KEY)
```
Agents join the gatherer specified (`demo` above). Agents with the same gatherer
share information with each other, whichever harness runs them (see the [example](#awareness-across-agents)). Agents in
different gatherers don't share context and each gatherer keeps its own history.

For example, the first two agents below share information; the third, in a
gatherer of its own, sees neither of them:

```bash
ag --gatherer frontend claude                            # shares with the Codex below
ag --gatherer frontend codex                             # shares with the Claude Code above
ag --gatherer backend codex                              # shares with neither
```

Without `--gatherer`, a session joins the gatherer `default`:

```bash
ag codex                                                 # the same as: ag --gatherer default codex
```

Use `--gatherer .` to create a new, unnamed gatherer. Agents created
this way don't share context with other agents:

```bash
ag --gatherer . codex
```

To see every gatherer:

```bash
ag gatherers                                             # each one's policy, pollers, event count, last activity
```

## Agentic Development Environment

Run `ag` on its own to open ag's agentic development environment in your browser:

```bash
ag                                                       # http://127.0.0.1:4200
```

From it you can create gatherers, start Claude Code and Codex Actors in them and talk to them, watch what
every Actor is doing, edit files alongside them, and see the context the Gatherer gave each one. It's only
reachable from your own machine. For other options, like the port, see `ag dashboard --help`.

### Actors and the gatherer agent

The actors the dashboard runs can reach one another. Every actor is told about
the others, and about `ag actors`, a command it runs in its shell:

```bash
ag actors                                    # the other actors of this gatherer: ids, status, what each was asked
ag actors who page.html                      # which actors changed a file
ag actors send 1a2b3c4d "I'm editing x.py"   # a message to one, typed into its conversation
ag actors send gatherer "..."                # a message to the gatherer agent
```

The **gatherer agent** coordinates a gatherer's actors. Open it from the
gatherer's row in the dashboard and talk to it like any actor: "after actor A is
done, tell actor B to do X", or "when A is done, start another actor on what it
left". When an actor finds another one working on its files or on the same task,
it stops and tells the gatherer agent, which decides who does what and tells each
actor. In Chat, a message between actors shows with its sender's avatar -- the
gatherer agent's is a manager owl. What you tell the gatherer agent stays out of
the actors' context: they know only what it sends them.

## Examples

The Actor-Gatherer framework improves accuracy by ensuring agents have the right information at the right time:

- **Across and within long-running sessions:** The Gatherer identifies what matters from a long interaction history, retrieves relevant information when needed, and filters out what is no longer useful.
- **Across parallel agents:** Agents managed by the same Gatherer, even across different harnesses, benefit from each other’s work.
- **As the environment changes:** The Gatherer informs the agent when relevant information in the environment changes. For example, when a relevant file changes, the Gatherer alerts the agent before it acts on stale information.

Below are a few short examples.

### Awareness across agents

`ag` proactively shares information across agents when one needs it, as long as
they are in the same gatherer, even if they run in different harnesses.

**1. Terminal 1: start Codex in a gatherer named `demo`, with a first message.**

```bash
ag --gatherer demo codex "Let X = 5. What is 2X?"
```

> **You → Codex:** Let X = 5. What is 2X?
>
> **Codex:** If X = 5, then 2X = 2 × 5 = 10.

**2. Terminal 2 (or after the first session has ended): start Claude Code in the
same gatherer.**

```bash
ag --gatherer demo claude "What is 3X?"
```

> **You → Claude Code:** What is 3X?
>
> **Claude Code:** 3X = 15.
>
> Your question doesn't define X, so I took X = 5 from your message to the other
> agent ("Let X = 5. What is 2X?").

Claude Code never saw the Codex session. Both are in `demo`, so the Gatherer
gave it Codex's request, and told it where to read the rest of that session's
work.

### Information from the environment

`ag` observes the agent's environment, such as the files in its working
directory, and tells the agent when something it relied on has changed. The
example's data file is in this repo, at [`demo/salaries.csv`](https://github.com/ucbepic/actor-gatherer/blob/main/demo/salaries.csv).

**1. Terminal 1: copy the demo file and start Codex next to it.** The copy keeps
the repo's file as it is when you edit it.

```bash
mkdir -p /tmp/ag-salaries && cp demo/salaries.csv /tmp/ag-salaries/ && cd /tmp/ag-salaries
ag --gatherer salaries codex
```

**2. In Codex: ask about the file.**

> **You → Codex:** I'm putting together a compensation benchmark from salaries.csv.
> Where does Germany's average salary sit relative to the median of the countries
> listed?
>
> **Codex:** Germany ($58,940) sits $3,820 above the median ($55,120, the United
> Kingdom).

**3. Terminal 2: change the file while the Codex session stays open.** This
changes Japan from 42,180 to 47,152 (or edit the file by hand):

```bash
f=/tmp/ag-salaries/salaries.csv; c=$(<"$f"); printf '%s\n' "${c/Japan,42180,/Japan,47152,}" > "$f"
```

**4. In the same Codex session: ask a second question.**

> **You → Codex:** How large is the gap between France and Japan, in USD?
>
> **Codex:** France: $49,310. Japan: $47,152. The gap between France and Japan is
> $2,158.

Before this question reached the model, the Gatherer told Codex that
`salaries.csv` had changed after it last read it, so Codex read the file again.

**To compare,** repeat the steps with plain `codex`, starting from a fresh copy:

```bash
mkdir -p /tmp/plain-salaries && cp demo/salaries.csv /tmp/plain-salaries/ && cd /tmp/plain-salaries
codex
```

Asked the same two questions, with the same change in between, plain Codex answers
$7,130 to the second, which is incorrect: it uses Japan's old value from its first
read.

### Information across sessions

`ag` keeps relevant information across sessions in context. Here, we show an example for a data analysis task with schema
ambiguity, where it is unclear which column should be used to join two of the tables (details
[here](https://github.com/ucbepic/actor-gatherer/tree/main/demo/cross_session)). The user picks a join column
that should be reapplied in a new session.

**1. Make the database in a new folder, and start Claude Code there.**

```bash
mkdir -p /tmp/tv-analytics && python3 demo/cross_session/make_db.py /tmp/tv-analytics/studios.sqlite && cd /tmp/tv-analytics
ag --gatherer tv-analytics claude
```

**2. In Claude Code:**

> **You → Claude Code:** In studios.sqlite, which studios have the most catalogue entries? Top five, name and count.
>
> **You → Claude Code:** Which genres are most common across the catalogue? Give counts.
>
> **You → Claude Code:** Join catalogue to companies on catalogue.feed_tag = companies.callsign and give the top five studios by catalogue entries, name and count.
>
> **You → Claude Code:** Reply with a short report with exactly these fields:
> Title: Catalogue Report; Total entries: 704; Genre counts …; National Broadcasting entries: 105

**3. Exit, and start a new session in the same folder and gatherer.**

```bash
ag --gatherer tv-analytics claude
```

> **You → Claude Code:** Which five studios have the most Drama entries? Name and count.
>
> **Claude Code:** These are the five studios with the most Drama entries. I matched
> entries to studios on `feed_tag = callsign`, the join you chose in your last studio
> question. …

It answers National Broadcasting 46, ABC Network 31, Public Broadcasting 21, FBC 18,
Columbia Broadcasting 9, which is correct. Running the same steps without `ag` leads the
new session to use the wrong join key.

Scripts to run the example are in [`demo/cross_session`](https://github.com/ucbepic/actor-gatherer/tree/main/demo/cross_session).
To run it, do `demo/cross_session/run.sh ag` (or `demo/cross_session/run.sh plain` to run it without `ag`).

## How it works

![Actor-Gatherer architecture: each Actor (a harness plus its adaptor) calls insert and get_context on the Gatherer, which holds the context and insertion policy and a database; pollers watch the environment and insert events](https://raw.githubusercontent.com/ucbepic/actor-gatherer/main/assets/architecture.png)

The **Gatherer** is a server that many **Actors** talk to, and the Actors can come
from different coding harnesses. An Actor is a harness plus its **adaptor**, which
turns the harness's messages into a unified data representation and the Gatherer's context back into
message format the harness supports. Each Actor uses two calls on the Gatherer:
- **`insert`** gives the Gatherer what the Actor has seen and done.
- **`get_context`** runs before each model call, and returns the context the model gets.

**Pollers** bring in information from the environment, such as files changed under
the working directory. The Gatherer asks them for new events in the environment, and they insert
those events like an Actor would. A **context management policy** inside the
Gatherer then decides what context each Actor gets, using everything it has
gathered from every Actor and from the environment.

`ag` currently uses:
- **Adaptors:** [`ClaudeAdaptor`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/integrations/harnesses/claude/adaptor/adaptor.py),
  [`CodexAdaptor`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/integrations/harnesses/codex/adaptor/adaptor.py),
  [`OpencodeAdaptor`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/integrations/harnesses/opencode/adaptor/adaptor.ts) and
  [`PiAdaptor`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/integrations/harnesses/pi/adaptor/adaptor.ts), each with the
  launcher `ag` uses to start that harness connected to the Gatherer.
- **Pollers:** [`FileChangePoller`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/ag_pollers/file_changes.py),
  which reports changes to the files the conversation names, under the agent's
  working directory, since it last looked.
- **Context Policy:** [`ProactiveContextManager`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/ag_policies/proactive_context_manager/policy.py),
  which searches earlier history in the
  background, and adds what other sessions asked for and what changed in the
  environment.

## Extensions

`ag` is extensible. You can:

- write your own [context policy](https://ucbepic.github.io/actor-gatherer/docs.html#write-policy), which decides what the
  agent's context holds,
- write your own [poller](https://ucbepic.github.io/actor-gatherer/docs.html#write-poller), which brings in information from the
  environment, or
- [add a harness](https://ucbepic.github.io/actor-gatherer/docs.html#write-adaptor), so another coding agent can run with `ag`.

See [Extending ag](https://ucbepic.github.io/actor-gatherer/docs.html#extending) in the docs.
